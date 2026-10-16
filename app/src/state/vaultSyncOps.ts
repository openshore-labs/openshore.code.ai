// Sync on all devices, the store's side (founder, 2026-10-16). The pass itself is
// pure (lib/gitos/sync.ts); this module runs it: one pass at a time, the
// ledger kept per computer in the sealed store, and the moments a pass runs
// (docking, the computer coming back, the app coming forward, a save here, a
// slow tick while docked). store.ts only wires it in.
import { storeDelete, storeGetJson, storeSetJson } from '../lib/platform.js';
import {
  conflictCopyPath,
  syncPass,
  type SyncLedger,
  type SyncOptions,
  type SyncResult,
  type SyncSide,
} from '../lib/gitos/sync.js';

/** Where the vault's files live, the Settings choice. Undefined is 'all'. */
export type VaultSyncMode = 'all' | 'one';

export function vaultSyncMode(setting: VaultSyncMode | undefined): VaultSyncMode {
  return setting ?? 'all';
}

/** How often a docked device looks for the computer's changes on its own. */
export const VAULT_SYNC_TICK_MS = 60_000;
/** How long after a save here the pass waits, so typing is one push. */
export const VAULT_SYNC_AFTER_SAVE_MS = 3_000;

/** A short, stable key for a computer's base URL. */
export function hubKey(baseUrl: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < baseUrl.length; i++) {
    h ^= baseUrl.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function ledgerKey(resourceId: string, baseUrl: string): string {
  return `oscode.gitos.sync.${resourceId}.${hubKey(baseUrl)}`;
}

export interface VaultSyncDeps {
  /** This device's vault, or undefined when it is not on this device. */
  local(): SyncSide | undefined;
  /** The docked computer's vault and its base URL, or undefined. */
  remote(): { side: SyncSide; baseUrl: string } | undefined;
  /** Words for this device in a conflict copy's name, e.g. "from this iPhone". */
  from(): string;
  /** After a pass that changed anything here or kept both versions. */
  onResult(result: SyncResult): void;
  /** What the pass carries, when it is not notes (chats, projects). */
  pass?: Omit<Partial<SyncOptions>, 'conflictPath'> & Partial<Pick<SyncOptions, 'conflictPath'>>;
}

export interface VaultSync {
  /** Run a pass now (or right after the one running). Resolves with its
   *  result, or undefined when there was nothing to sync with or it failed. */
  run(): Promise<SyncResult | undefined>;
  /** Run a pass after `ms`, folding repeated asks into one. */
  soon(ms?: number): void;
  /** Forget a computer's ledger (unpairing). */
  forget(baseUrl: string, resourceId: string): Promise<void>;
  /** Stop any waiting pass. */
  stop(): void;
}

export function createVaultSync(deps: VaultSyncDeps): VaultSync {
  let running: Promise<SyncResult | undefined> | undefined;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function once(): Promise<SyncResult | undefined> {
    const local = deps.local();
    const remote = deps.remote();
    if (!local || !remote) return undefined;
    const key = ledgerKey(local.resourceId, remote.baseUrl);
    const ledger = (await storeGetJson<SyncLedger>(key).catch(() => undefined)) ?? {};
    const day = new Date().toISOString().slice(0, 10);
    let result: SyncResult;
    try {
      result = await syncPass(local, remote.side, ledger, {
        conflictPath: (p, taken) => conflictCopyPath(p, deps.from(), day, taken),
        ...deps.pass,
      });
    } catch {
      // The computer is away, or its list was cut short: nothing changed.
      return undefined;
    }
    await storeSetJson(key, result.ledger).catch(() => {});
    if (result.pulled.length || result.removed.length || result.conflicts.length) {
      deps.onResult(result);
    }
    return result;
  }

  function run(): Promise<SyncResult | undefined> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let last: SyncResult | undefined;
      do {
        again = false;
        last = await once();
      } while (again);
      return last;
    })().finally(() => {
      running = undefined;
    });
    return running;
  }

  return {
    run,
    soon(ms = VAULT_SYNC_AFTER_SAVE_MS) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, ms);
    },
    async forget(baseUrl, resourceId) {
      await storeDelete(ledgerKey(resourceId, baseUrl)).catch(() => {});
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
