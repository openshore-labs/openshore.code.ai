// The Vault editor saves as you type, debounced so the sealed store is not
// hammered per keystroke (the way Obsidian saves). The vault the text was
// typed into is fixed when the save is scheduled (0.7): a scope flip or a
// sign-out inside the debounce changes where a NEW save would go, never where
// the text already typed goes. The pending text can be flushed (the screen
// leaves, the app goes to the background, another note opens) or dropped (the
// note it belongs to is being deleted). Pure and timer-driven, so the capture
// is testable without a screen (test/vaultAutosave.test.ts).

/** How long the editor waits after the last keystroke before it saves. */
export const VAULT_AUTOSAVE_MS = 600;

/** Text typed and waiting for the debounce, with the vault it goes to. */
export interface VaultAutosavePending<T extends TargetLike = TargetLike> {
  path: string;
  text: string;
  at: T | undefined;
}

export interface VaultAutosave<T extends TargetLike = TargetLike> {
  /** Save this text after the debounce, to the vault targeted right now. */
  schedule(path: string, text: string): void;
  /** Send the pending text now, to the vault it was typed into. */
  flush(): void;
  /** Drop the pending text without sending it. */
  cancel(): void;
  /** Text is typed and waiting for the debounce (the save chip's Saving). */
  isPending(): boolean;
  /** Stop the timer and hand the pending text over, for a caller that saves
   *  it itself and waits for the save (a Vault M6 operation flushing first,
   *  so no stale timer can land after it). */
  take(): VaultAutosavePending<T> | undefined;
}

/** A target is a vault on a storage, and for the team vault the account the
 *  text was typed under. */
export type TargetLike = { providerId: string; resourceId: string; owner?: string };

const sameTarget = (a: TargetLike | undefined, b: TargetLike | undefined) =>
  a?.providerId === b?.providerId && a?.resourceId === b?.resourceId && a?.owner === b?.owner;

export function vaultAutosave<T extends TargetLike>(opts: {
  /** Where a save made now would go (the store's vaultTargetRef). */
  target: () => T | undefined;
  /** Write the text to that target (the store's vaultSave). */
  save: (path: string, text: string, at: T | undefined) => void;
  delayMs?: number;
}): VaultAutosave<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { path: string; text: string; at: T | undefined } | undefined;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    stop();
    const p = pending;
    pending = undefined;
    if (p) opts.save(p.path, p.text, p.at);
  };
  return {
    schedule(path, text) {
      const at = opts.target();
      // Text typed for another note, or under another vault or account, is
      // never replaced by this one: it goes to its own place first.
      if (pending && (pending.path !== path || !sameTarget(pending.at, at))) flush();
      stop();
      pending = { path, text, at };
      timer = setTimeout(flush, opts.delayMs ?? VAULT_AUTOSAVE_MS);
    },
    flush,
    cancel() {
      stop();
      pending = undefined;
    },
    isPending() {
      return pending !== undefined;
    },
    take() {
      stop();
      const p = pending;
      pending = undefined;
      return p;
    },
  };
}
