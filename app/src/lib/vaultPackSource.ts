// The app's vault context pack (Vault M5, CTO J1): the exact engine pack
// (`planContextPack` and `buildContextPack` from os-code/protocol), prepared
// once per send and rendered per seat, mirroring core/vault/contextSource.ts
// and the loop's `renderPack`.
//
// `prepare` gathers what a render needs apart from the seat, within the cold
// budget (`VAULT_PACK_COLD_MS`): the personal vault's index when it is warm,
// this project's Current State, the note bodies the widest plan asks for, and
// the privacy rules. Whatever lands after the budget serves the next send.
// `render` then builds the pack for whichever seat answers, so a Stack
// re-route or a fallback renders again without reading anything again. The
// team vault is never in context (D15): the store hands no index while another
// target is on screen, and this never switches one.
import {
  MODEL_CLASSES,
  PACK_PINS_MAX,
  PACK_PLAN_MAX_READS,
  VAULT_PACK_COLD_MS,
  VAULT_PACK_MAX_TOKENS,
  buildContextPack,
  compareCodePoints,
  deriveProfile,
  packBudgetTokens,
  packModeFor,
  planContextPack,
  type ContextPack,
  type DriverEvent,
  type ModelClass,
  type ModelClassProfile,
  type PackMode,
  type VaultIndex,
  type VaultPrivacy,
} from 'os-code/protocol';
import type { AppVaultPack, PackSeat } from '../drivers/types.js';
import { PROJECT_VAULT_PINS_MAX, type AppVaultContextSetting } from '../state/types.js';
import type { VaultIndexHost } from './vaultIndexHost.js';

/** What a conversation's pack is built from. The store builds one per
 *  conversation in `buildUnguardedDriver`. */
export interface AppVaultPackDeps {
  /** `settings.vaultContext` (unset reads 'auto'). */
  setting: AppVaultContextSetting;
  /** The personal vault's index host (`vaultIndexFor` on the personal
   *  target), or undefined when another target is on screen (the team vault
   *  is never in context, D15) or none is open. Never switches the target. */
  index: () => VaultIndexHost | undefined;
  /** A note body through the provider seam (`read`); undefined when gone.
   *  Hidden notes are filtered before any read. */
  read: (path: string) => Promise<string | undefined>;
  /** The compiled privacy rules (`appVaultPrivacy`). */
  privacy: () => Promise<VaultPrivacy>;
  /** This project's Current State (`primaryRepoSource` with
   *  `localRepoReader` or `githubRepoReader`), cached per project for 10
   *  minutes, capped at 256 KB; undefined when neither is readable. */
  currentState: () => Promise<{ path: string; text: string } | undefined>;
  /** The key Current State is cached under (the project id). Packs of one
   *  project share it; unset caches per pack. */
  projectKey?: string;
  /** The active project's pins (`Project.vaultPins`, J14). */
  projectPins?: () => readonly string[];
  /** A handoff for a conversation's first send, at most
   *  `HANDOFF_MAX_AGE_DAYS` old (J13); undefined for none. Asked on the
   *  first prepare only. */
  handoff?: () => string | undefined;
  /** The cold budget in ms (default `VAULT_PACK_COLD_MS`). */
  coldMs?: number;
  /** Test seam: the clock for the Current State cache. */
  now?: () => number;
}

/** The pack Current State is cached for, per project (J1). */
export const CURRENT_STATE_CACHE_MS = 10 * 60 * 1000;
/** The largest Current State a pack reads, like the engine (J1). */
export const CURRENT_STATE_MAX_BYTES = 256 * 1024;
/** Note bodies read at once. */
const READ_CONCURRENCY = 4;
/** Frontmatter pins a prepare hands on at most, as the engine's prepare. */
const PREPARED_PINS_MAX = 8;
/** Packs with no project key each cache on their own. */
let packSeq = 0;

type CurrentState = { path: string; text: string };

/** Current State per project: the last answer and when it came, plus a read
 *  in flight so two sends never read it twice. */
const currentStateCache = new Map<
  string,
  { at: number; value: CurrentState | undefined; inFlight?: Promise<CurrentState | undefined> }
>();

/** Forget every cached Current State (a sign-out, a pairing change, a test). */
export function clearCurrentStateCache(): void {
  currentStateCache.clear();
}

/** A representative size per class, so the class's policy (its pack
 *  fraction) comes from the core's own table through `deriveProfile`. */
const CLASS_PARAMS_B: Readonly<Record<ModelClass, number>> = {
  tiny: 1,
  small: 5,
  mid: 16,
  large: 64,
};

/** The core's profile for a class, exactly as the engine derives it. */
export function classProfile(modelClass: ModelClass): ModelClassProfile {
  return deriveProfile({ model: '', kind: 'local', paramsB: CLASS_PARAMS_B[modelClass] });
}

/** UTF-8 length without a Buffer (the phone has none). */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Settle with the promise's value, or undefined once `ms` passes or the
 *  signal aborts. The promise itself goes on. */
function within<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    if (signal?.aborted) return resolve(undefined);
    const timer = setTimeout(() => done(undefined), Math.max(0, ms));
    const onAbort = () => done(undefined);
    signal?.addEventListener('abort', onAbort, { once: true });
    let settled = false;
    function done(v: T | undefined) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(v);
    }
    p.then(done, () => done(undefined));
  });
}

/** The frontmatter pins in an index (`oscode: pin`) that are not hidden, in
 *  code-point order, as the engine's `frontmatterPins` finds them. */
function frontmatterPins(index: VaultIndex, privacy: VaultPrivacy): string[] {
  const out: string[] = [];
  for (const e of index.entries()) {
    if (!e.oscode?.includes('pin') || e.evicted) continue;
    if (privacy.visibility({ path: e.path, tags: e.tags, oscode: e.oscode }) === 'hidden') {
      continue;
    }
    out.push(e.path);
  }
  return out.sort(compareCodePoints).slice(0, PREPARED_PINS_MAX);
}

/** What one prepare gathered. */
interface Prepared {
  stamp: number;
  query: string;
  /** A vault was on offer (the personal index host), so vault layers may
   *  render; without one the pack is Current State only, as on the engine. */
  hasVault: boolean;
  index: VaultIndex | null;
  bodies: ReadonlyMap<string, string>;
  currentState?: CurrentState;
  pins: readonly string[];
  projectPins: readonly string[];
  handoff?: string;
  privacy: VaultPrivacy;
}

/** One conversation's pack. */
export function createAppVaultPack(deps: AppVaultPackDeps): AppVaultPack {
  const coldMs = deps.coldMs ?? VAULT_PACK_COLD_MS;
  const now = deps.now ?? (() => Date.now());
  const cacheKey = deps.projectKey ?? `pack:${++packSeq}`;
  let prepared: Prepared | undefined;
  let stamp = 0;
  let asked = false;
  let renderCache: { key: string; pack: ContextPack | undefined; localOnly: boolean } | undefined;
  let cardShown: string | undefined;
  let lastPrivacy: VaultPrivacy | undefined;

  /** The privacy rules, asked afresh each send. After the first answer a
   *  slow source costs no more than the cold budget: the last rules stand in
   *  until the new ones land. The first send waits, since no rules at all is
   *  never a fallback. */
  async function privacyNow(signal?: AbortSignal): Promise<VaultPrivacy> {
    const fresh = deps.privacy().then((rules) => (lastPrivacy = rules));
    if (!lastPrivacy) return fresh;
    const known = lastPrivacy;
    return (await within(fresh, coldMs, signal)) ?? known;
  }

  /** Current State from the cache when fresh, else one read (shared with a
   *  send already waiting on it), which fills the cache when it lands. */
  function currentState(): Promise<CurrentState | undefined> {
    const hit = currentStateCache.get(cacheKey);
    if (hit?.inFlight) return hit.inFlight;
    if (hit && now() - hit.at < CURRENT_STATE_CACHE_MS) return Promise.resolve(hit.value);
    const inFlight = (async () => {
      let value: CurrentState | undefined;
      try {
        const got = await deps.currentState();
        value = got && utf8Bytes(got.text) <= CURRENT_STATE_MAX_BYTES ? got : undefined;
      } catch {
        value = undefined;
      }
      currentStateCache.set(cacheKey, { at: now(), value });
      return value;
    })();
    currentStateCache.set(cacheKey, { at: hit?.at ?? 0, value: hit?.value, inFlight });
    return inFlight;
  }

  /** The index, when the host has one loaded within the budget. A saved
   *  index counts before its reconcile finishes (a note gone since is simply
   *  not read), as on the engine. */
  async function warmIndex(
    host: VaultIndexHost | undefined,
    signal?: AbortSignal,
  ): Promise<VaultIndex | null> {
    if (!host) return null;
    const opened = await within(
      host.open().then(() => true),
      coldMs,
      signal,
    );
    if (!opened) return null;
    return host.index.size > 0 || host.state === 'ready' ? host.index : null;
  }

  /** The widest mode any seat can render under this setting: bodies no seat
   *  can use are never read (every class is Current State only until the
   *  4.8 eval, I9, so today only project pins are read). */
  function widestMode(): PackMode | null {
    let widest: PackMode | null = null;
    for (const c of MODEL_CLASSES) {
      const m = packModeFor(deps.setting, c);
      if (m === 'full') return 'full';
      if (m) widest = m;
    }
    return widest;
  }

  async function gather(task: string, signal?: AbortSignal): Promise<Prepared | undefined> {
    const mode = widestMode();
    if (!mode) return undefined;
    const host = deps.index();
    const [privacy, index, current] = await Promise.all([
      privacyNow(signal),
      warmIndex(host, signal).catch(() => null),
      within(currentState(), coldMs, signal),
    ]);
    const handoff = asked ? undefined : deps.handoff?.();
    asked = true;
    const projectPins = (deps.projectPins?.() ?? []).slice(0, PROJECT_VAULT_PINS_MAX);
    const pins = index ? frontmatterPins(index, privacy) : [];
    const bodies = new Map<string, string>();
    if (index && !signal?.aborted) {
      const planned = planContextPack({
        mode,
        index,
        query: task,
        ...(current ? { currentState: current } : {}),
        pins,
        projectPins,
        budgetTokens: VAULT_PACK_MAX_TOKENS,
        privacy,
        seat: { modelClass: 'large', leavesNetwork: false },
        lockdown: { egress: false, secrets: false },
      }).read;
      // The person's own pins ride in both modes (J14), so their bodies are
      // read whatever the plan says, up to the pin layer's cap.
      const wanted = [...new Set([...planned, ...projectPins.slice(0, PACK_PINS_MAX)])];
      // Belt and braces: a hidden note is never read, whatever the plan says,
      // and a note the index does not hold (or holds evicted) is not fetched.
      const reads = wanted
        .filter((path) => {
          const e = index.entry(path);
          if (!e || e.evicted) return false;
          return privacy.visibility({ path, tags: e.tags, oscode: e.oscode }) !== 'hidden';
        })
        .slice(0, PACK_PLAN_MAX_READS);
      let next = 0;
      const worker = async () => {
        while (next < reads.length && !signal?.aborted) {
          const path = reads[next++]!;
          try {
            const text = await deps.read(path);
            if (text !== undefined) bodies.set(path, text);
          } catch {
            // A note that cannot be read is left out, never an error.
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, reads.length) }, worker));
    }
    return {
      stamp: ++stamp,
      query: task,
      hasVault: host !== undefined,
      index,
      bodies,
      ...(current ? { currentState: current } : {}),
      pins,
      projectPins,
      ...(handoff?.trim() ? { handoff } : {}),
      privacy,
    };
  }

  return {
    async prepare(task: string, signal?: AbortSignal): Promise<void> {
      // A new send: the last send's pack and card are over.
      prepared = undefined;
      renderCache = undefined;
      cardShown = undefined;
      try {
        prepared = await gather(task, signal);
      } catch {
        // A pack that cannot be gathered leaves the send without one, never
        // without an answer.
        prepared = undefined;
      }
    },

    render(seat: PackSeat): { text?: string; event?: DriverEvent } {
      const p = prepared;
      if (!p) return {};
      let mode = packModeFor(deps.setting, seat.modelClass);
      if (!mode) return {};
      if (!p.hasVault) mode = 'current-state';
      const budgetTokens = packBudgetTokens(classProfile(seat.modelClass), seat.servedTokens);
      const leaves = seat.leavesNetwork;
      const key = JSON.stringify([mode, budgetTokens, seat.modelClass, leaves, p.stamp]);
      if (renderCache?.key !== key) {
        let pack: ContextPack | undefined;
        try {
          pack = buildContextPack({
            mode,
            index: p.hasVault ? p.index : null,
            query: p.query,
            ...(p.currentState ? { currentState: p.currentState } : {}),
            pins: p.pins,
            projectPins: p.projectPins,
            ...(p.handoff ? { handoff: p.handoff } : {}),
            budgetTokens,
            privacy: p.privacy,
            seat: { modelClass: seat.modelClass, leavesNetwork: leaves },
            // App chats never carry project secrets.
            lockdown: { egress: false, secrets: false },
            bodies: p.bodies,
          });
        } catch {
          pack = undefined;
        }
        // The builder judges each note it placed (a project pin the index has
        // not read, by its own body), the same rule the engine's card uses.
        renderCache = { key, pack, localOnly: !leaves && pack?.localOnly === true };
      }
      const pack = renderCache.pack;
      if (!pack) return {};
      const text = pack.text || undefined;
      if (!pack.text && !pack.withheld) return {};
      // A local seat's pack may carry a note that stays on this computer; the
      // reply it grounds is marked, so a later leaving seat gets the stub.
      const mark = text && renderCache.localOnly ? { localOnly: true as const } : {};
      const where = leaves ? 'cloud' : 'local';
      const card = JSON.stringify([where, pack.used, pack.withheld]);
      if (card === cardShown) return text ? { text, ...mark } : {};
      cardShown = card;
      const event: DriverEvent = {
        type: 'context-pack',
        seat: where,
        mode,
        tokens: pack.tokens,
        budgetTokens,
        sources: pack.used,
        withheld: pack.withheld,
        cold: pack.cold,
      };
      return text ? { text, event, ...mark } : { event };
    },
  };
}
