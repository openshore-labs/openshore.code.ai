// The engine's source for a session's vault context pack (Vault M4, CTO I7,
// I8). Once per task (`prepare`), it gathers what a render needs apart from
// the seat: the vault index when it is ready in time, the note bodies the
// widest plan asks for, this project's Current State, the frontmatter pins,
// and the compiled privacy rules. The loop then renders `buildContextPack`
// per turn for whichever seat answers, so an escalation re-renders under the
// cloud seat's rules without reading anything again.
//
// The cold budget: prepare waits at most VAULT_PACK_COLD_MS for the saved
// index to load. A loaded index counts even before its reconcile finishes
// (bodies come from disk, and a note gone since is skipped); otherwise the
// index is null, the pack is Current State only (the builder marks it cold),
// and the build goes on in the background for the next task.
//
// Vault M5 adds two inputs the person placed, not the index: the project's own
// pins (CTO J14), read first, in both modes, with privacy judged from the
// note itself; and the latest handoff (J13), read on the session's first
// prepare only. The handoff stays a full-mode layer, so by default it reaches
// no seat until the 4.8 eval says it should.
//
// A thin adapter on purpose: the planning and rendering are the pure
// planContextPack and buildContextPack in harness/vaultContext.ts, injected
// here so a test can stand them in.
import { VAULT_PACK_MAX_TOKENS } from '../../harness/profile.js';
import {
  VAULT_PACK_COLD_MS,
  planContextPack as corePlan,
  type PackInput,
  type PreparedVaultContext,
  type VaultContextSource,
} from '../../harness/vaultContext.js';
import { compareCodePoints, type VaultIndex } from '../../harness/vault/index.js';
import { readFrontmatter } from '../../harness/vault/frontmatter.js';
import { isNotePath } from '../../harness/vault/paths.js';
import { oscodeMarks } from '../../harness/vault/privacy.js';
import { scanNote } from '../../harness/vault/scan.js';
import { retrievalSkipped } from '../../harness/vault/settings.js';
import type {
  ResolvedVaultSettings,
  VaultPrivacy,
  VaultVisibility,
} from '../../harness/vault/types.js';
import { readFile } from 'node:fs/promises';
import { CURRENT_STATE_FILE, memoryFilePath, memorySegment } from '../agent/projectMemory.js';
import { Jail } from '../security/jail.js';
import { engineVaultIndex, type EngineVaultIndex } from './engineIndex.js';
import { LIST_CONCURRENCY, eachLimited } from './listNotes.js';
import { readNote } from './noteFile.js';

// The cold budget moved to the pure core (Vault M5, CTO J1) so the app waits
// the same; re-exported here for existing importers.
export { VAULT_PACK_COLD_MS } from '../../harness/vaultContext.js';

/** Frontmatter pins a prepare hands on at most (the builder takes at most 3). */
export const PREPARED_PINS_MAX = 8;

/** Project pins a prepare reads at most (`Project.vaultPins` holds 8). */
export const PROJECT_PINS_MAX = 8;

export interface VaultContextSourceOptions {
  /** The session's own vault root; unset leaves every vault layer out (the
   *  pack is Current State only). */
  vaultRoot?: string;
  /** The compiled privacy rules (`compileVaultPrivacy(config.vault)`). */
  privacy: VaultPrivacy;
  /** This project's Current State, read from the repo (not the vault). Called
   *  once per prepare; undefined or a throw means none. */
  currentState?: () =>
    | { path: string; text: string }
    | undefined
    | Promise<{ path: string; text: string } | undefined>;
  /** The session's lockdown, carried into the host's plan. */
  lockdown?: { egress: boolean; secrets: boolean };
  /** The project's own pins (`BootstrapOptions.vaultPins`, CTO J14), note
   *  paths in the person's order. Read first by every prepare. */
  projectPins?: readonly string[];
  /** The latest stored handoff (CTO J13), asked once, on the first prepare
   *  only; undefined or a throw means none. The caller gates it (the
   *  `vault.handoff` key, Memory, a fresh session). */
  handoff?: () => string | undefined | Promise<string | undefined>;
  /** The vault's resolved settings as last refreshed (Vault M7, CTO L2):
   *  the templates folder and Obsidian's ignore filters are left out of the
   *  retrieval reads. Unset leaves every note a candidate. */
  settings?: () => Pick<ResolvedVaultSettings, 'templates' | 'ignore'> | undefined;
  /** The cold budget in ms (default VAULT_PACK_COLD_MS). */
  coldMs?: number;
  /** Test seams. */
  plan?: (input: PackInput) => { read: string[] };
  openIndex?: (root: string) => Promise<EngineVaultIndex>;
  readBody?: (root: string, path: string) => Promise<string | undefined>;
}

/** A note body from disk, jailed to the root; undefined when it is gone or
 *  cannot be read. */
async function readBodyFromDisk(root: string, path: string): Promise<string | undefined> {
  try {
    return (await readNote(new Jail(root).resolve(path)))?.text;
  } catch {
    return undefined;
  }
}

/** The largest Current State a prepare reads; the builder cuts it to budget. */
const CURRENT_STATE_MAX_BYTES = 256 * 1024;

/** A reader for this project's Current State in the repo (the project-memory
 *  folder, "OpenShore Project <name> MDs/Current State.md"), for
 *  `currentState`. Undefined when there is no segment or no file. */
export function currentStateReader(
  cwd: string,
  projectName: string | undefined,
): () => Promise<{ path: string; text: string } | undefined> {
  return async () => {
    const segment = memorySegment(projectName, cwd);
    if (!segment) return undefined;
    const path = memoryFilePath(segment, CURRENT_STATE_FILE);
    try {
      const text = await readFile(new Jail(cwd).resolve(path), 'utf8');
      if (Buffer.byteLength(text, 'utf8') > CURRENT_STATE_MAX_BYTES) return undefined;
      return { path, text };
    } catch {
      return undefined;
    }
  };
}

/** The frontmatter pins in an index (`oscode: pin`) that are not hidden, in
 *  code-point order. A pin never lifts a restriction, so a local-only pin
 *  stays in (the builder withholds it from a leaving seat). */
export function frontmatterPins(index: VaultIndex, privacy: VaultPrivacy): string[] {
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

/** A note's privacy judged from its own text (its frontmatter tags, inline
 *  tags and `oscode` marks), the way the index would judge it, for a note
 *  read before, or without, the index. The index's own entry, when there is
 *  one, adds its tags too, so the stricter reading wins. */
export function visibilityOfText(
  privacy: VaultPrivacy,
  path: string,
  text: string,
  index?: VaultIndex | null,
): VaultVisibility {
  const fm = readFrontmatter(text);
  const entry = index?.entry(path);
  const tags = [...fm.tags, ...scanNote(text).tags.map((t) => t.tag), ...(entry?.tags ?? [])];
  const oscode = [...oscodeMarks(fm), ...(entry?.oscode ?? [])];
  return privacy.visibility({ path, tags, oscode });
}

/** The project pins worth offering: note paths, deduped, at most
 *  PROJECT_PINS_MAX, in the person's order. */
export function cleanProjectPins(pins: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of pins ?? []) {
    if (typeof raw !== 'string') continue;
    const path = raw.trim();
    if (!path || out.includes(path) || !isNotePath(path)) continue;
    out.push(path);
    if (out.length >= PROJECT_PINS_MAX) break;
  }
  return out;
}

/** Build the engine's VaultContextSource for one session. */
export function createVaultContextSource(options: VaultContextSourceOptions): VaultContextSource {
  const plan = options.plan ?? corePlan;
  const openIndex = options.openIndex ?? engineVaultIndex;
  const readBody = options.readBody ?? readBodyFromDisk;
  const coldMs = options.coldMs ?? VAULT_PACK_COLD_MS;
  const { privacy } = options;
  const wantedPins = cleanProjectPins(options.projectPins);
  let handoffAsked = false;
  return {
    async prepare(task: string, signal?: AbortSignal): Promise<PreparedVaultContext> {
      // The handoff is the session's first prepare's alone, asked even when
      // this prepare fails further down, so a later task never picks it up.
      let handoff: string | undefined;
      if (!handoffAsked) {
        handoffAsked = true;
        try {
          const text = await options.handoff?.();
          if (typeof text === 'string' && text.trim()) handoff = text;
        } catch {
          handoff = undefined;
        }
      }
      let currentState: { path: string; text: string } | undefined;
      try {
        currentState = (await options.currentState?.()) ?? undefined;
      } catch {
        currentState = undefined;
      }
      const root = options.vaultRoot;
      let index: VaultIndex | null = null;
      if (root && !signal?.aborted) {
        try {
          const handle = await openIndex(root);
          // A task is a good moment to catch edits made outside OpenShore.
          handle.refresh();
          if (await handle.whenLoaded(coldMs, signal)) index = handle.index;
        } catch {
          index = null;
        }
      }
      const pins = index ? frontmatterPins(index, privacy) : [];
      const bodies = new Map<string, string>();
      // The project's pins first (J14): the person placed them, so they ride
      // in both modes. Each is judged from its own text: a hidden one is never
      // handed on, and a local-only one the index has no entry for (a cold
      // index, a note not indexed yet) is left out too, since the render
      // judges by the index and could not withhold it from a leaving seat
      // (fail closed).
      const projectPins: string[] = [];
      if (root && wantedPins.length && !signal?.aborted) {
        // A note the rules hide by path (or by what the index knows of it) is
        // never read at all; one hidden by its own frontmatter is dropped
        // once read.
        const readable = wantedPins.filter((path) => {
          const e = index?.entry(path);
          return privacy.visibility({ path, tags: e?.tags, oscode: e?.oscode }) !== 'hidden';
        });
        const read = new Map<string, string>();
        await eachLimited(
          readable,
          LIST_CONCURRENCY,
          async (path) => {
            const text = await readBody(root, path);
            if (text !== undefined) read.set(path, text);
          },
          () => !signal?.aborted,
        );
        for (const path of wantedPins) {
          const text = read.get(path);
          if (text === undefined) continue;
          const seen = visibilityOfText(privacy, path, text, index);
          if (seen === 'hidden') continue;
          if (seen === 'local-only' && !index?.entry(path)) continue;
          projectPins.push(path);
          bodies.set(path, text);
        }
      }
      if (index && root && !signal?.aborted) {
        // The widest plan: every layer, the largest budget, a seat that stays
        // on this network. Each turn's render narrows it for its own seat.
        const wanted = plan({
          mode: 'full',
          index,
          query: task,
          ...(currentState ? { currentState } : {}),
          pins,
          ...(projectPins.length ? { projectPins } : {}),
          budgetTokens: VAULT_PACK_MAX_TOKENS,
          privacy,
          seat: { modelClass: 'large', leavesNetwork: false },
          lockdown: options.lockdown ?? { egress: false, secrets: false },
        }).read;
        // Belt and braces: a hidden note is never read, whatever the plan says.
        // A template or an Obsidian-ignored note is no retrieval candidate
        // (L2); unread, the render skips it.
        let settings: Pick<ResolvedVaultSettings, 'templates' | 'ignore'> | undefined;
        try {
          settings = options.settings?.();
        } catch {
          settings = undefined;
        }
        const reads = wanted.filter((path) => {
          if (bodies.has(path)) return false;
          if (retrievalSkipped(path, settings)) return false;
          const e = index!.entry(path);
          return privacy.visibility({ path, tags: e?.tags, oscode: e?.oscode }) !== 'hidden';
        });
        await eachLimited(
          reads,
          LIST_CONCURRENCY,
          async (path) => {
            const text = await readBody(root, path);
            if (text !== undefined) bodies.set(path, text);
          },
          () => !signal?.aborted,
        );
      }
      return {
        index,
        bodies,
        ...(currentState ? { currentState } : {}),
        pins,
        ...(projectPins.length ? { projectPins } : {}),
        ...(handoff ? { handoff } : {}),
        privacy,
      };
    },
  };
}
