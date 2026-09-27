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
// A thin adapter on purpose: the planning and rendering are the pure
// planContextPack and buildContextPack in harness/vaultContext.ts, injected
// here so a test can stand them in.
import { VAULT_PACK_MAX_TOKENS } from '../../harness/profile.js';
import {
  planContextPack as corePlan,
  type PackInput,
  type PreparedVaultContext,
  type VaultContextSource,
} from '../../harness/vaultContext.js';
import { compareCodePoints, type VaultIndex } from '../../harness/vault/index.js';
import type { VaultPrivacy } from '../../harness/vault/types.js';
import { readFile } from 'node:fs/promises';
import { CURRENT_STATE_FILE, memoryFilePath, memorySegment } from '../agent/projectMemory.js';
import { Jail } from '../security/jail.js';
import { engineVaultIndex, type EngineVaultIndex } from './engineIndex.js';
import { LIST_CONCURRENCY, eachLimited } from './listNotes.js';
import { readNote } from './noteFile.js';

/** The most a task waits for a vault's saved index before it goes on with
 *  Current State alone (CTO I7). */
export const VAULT_PACK_COLD_MS = 250;

/** Frontmatter pins a prepare hands on at most (the builder takes at most 3). */
export const PREPARED_PINS_MAX = 8;

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

/** Build the engine's VaultContextSource for one session. */
export function createVaultContextSource(options: VaultContextSourceOptions): VaultContextSource {
  const plan = options.plan ?? corePlan;
  const openIndex = options.openIndex ?? engineVaultIndex;
  const readBody = options.readBody ?? readBodyFromDisk;
  const coldMs = options.coldMs ?? VAULT_PACK_COLD_MS;
  const { privacy } = options;
  return {
    async prepare(task: string, signal?: AbortSignal): Promise<PreparedVaultContext> {
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
      if (index && root && !signal?.aborted) {
        // The widest plan: every layer, the largest budget, a seat that stays
        // on this network. Each turn's render narrows it for its own seat.
        const wanted = plan({
          mode: 'full',
          index,
          query: task,
          ...(currentState ? { currentState } : {}),
          pins,
          budgetTokens: VAULT_PACK_MAX_TOKENS,
          privacy,
          seat: { modelClass: 'large', leavesNetwork: false },
          lockdown: options.lockdown ?? { egress: false, secrets: false },
        }).read;
        // Belt and braces: a hidden note is never read, whatever the plan says.
        const reads = wanted.filter((path) => {
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
        privacy,
      };
    },
  };
}
