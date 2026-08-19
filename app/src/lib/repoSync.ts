// The offload-then-reset protocol, as pure decisions so it can be tested to
// death away from the network. The rules are the CTO's, and they are the whole
// point: nobody ever loses work.
//
//  - Apply buffered items in ULID order (their id is monotonic).
//  - Offload is idempotent on clientOpId: re-sending an applied op returns the
//    same resultCommit, so a lost ACK never double-commits.
//  - Confirm is INDEPENDENT of the apply response: the device re-reads the ref
//    and checks the commit exists and its tree matches the buffered file
//    hashes. A 200 is not confirmation.
//  - Reset is per-item and only after that item is confirmed. There is no
//    global wipe, and reset never touches unrelated sealed data.
//  - Stop a repo's batch at the first item that is not cleanly applied; later
//    items were composed assuming the earlier ones landed.
import type { OutboxItem } from './repos.js';

/** Buffered items for a repo, in apply order (ULID-sortable ids). */
export function pendingForRepo(items: OutboxItem[], repoId: string): OutboxItem[] {
  return items
    .filter((i) => i.repoId === repoId && (i.state === 'pending' || i.state === 'offloading'))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface ApplyResult {
  ok: boolean;
  /** The commit the home engine says it produced (or the idempotent replay). */
  resultCommit?: string;
  /** True when the base commit is no longer an ancestor of the branch tip. */
  conflict?: boolean;
  error?: string;
}

/**
 * Fold an apply response into the item. This does NOT confirm: a successful
 * apply moves the item to 'offloading' with its resultCommit, and confirmation
 * is a separate, independent step. A conflict or error is terminal for the
 * batch but never loses the item.
 */
export function applyResult(item: OutboxItem, res: ApplyResult): OutboxItem {
  // Idempotent: an already-confirmed item is untouched by a replay.
  if (item.state === 'confirmed') return item;
  const attempts = item.attempts + 1;
  if (res.conflict) {
    return { ...item, state: 'conflict', attempts, lastError: res.error ?? 'Base is behind the branch tip.' };
  }
  if (!res.ok || !res.resultCommit) {
    return { ...item, state: 'failed', attempts, lastError: res.error ?? 'Offload failed.' };
  }
  return { ...item, state: 'offloading', attempts, resultCommit: res.resultCommit, lastError: undefined };
}

export interface Verification {
  /** The commit exists on the (home or remote) target when re-read. */
  refExists: boolean;
  /** The commit's tree hashes match every buffered file's sha256. */
  treeMatches: boolean;
}

/**
 * The independent confirm step. Only a real, matching commit confirms an item;
 * anything else leaves it un-confirmed (and therefore un-resettable) rather
 * than pretending it landed.
 */
export function confirm(item: OutboxItem, v: Verification): OutboxItem {
  if (item.state !== 'offloading' || !item.resultCommit) return item;
  if (v.refExists && v.treeMatches) return { ...item, state: 'confirmed', lastError: undefined };
  return {
    ...item,
    state: 'failed',
    lastError: v.refExists ? 'The pushed commit did not match the buffered files.' : 'The commit was not found on re-read.',
  };
}

/** Items whose sealed blobs are safe to delete: confirmed, and only those. */
export function resettableIds(items: OutboxItem[]): string[] {
  return items.filter((i) => i.state === 'confirmed').map((i) => i.id);
}

/** A repo's batch must stop after an item that did not cleanly apply. */
export function stopsBatch(item: OutboxItem): boolean {
  return item.state === 'conflict' || item.state === 'failed';
}

/** How many items still need to sync, for a badge. */
export function unsyncedCount(items: OutboxItem[]): number {
  return items.filter((i) => i.state !== 'confirmed').length;
}

/** The rescue branch a conflicted item lands on, so nothing is force-pushed. */
export function rescueBranch(deviceId: string, item: OutboxItem): string {
  return `oscode/outbox/${deviceId}/${item.id}`;
}

// ---- buffer safety (the S2 posture: protect the pending window) ------------
//
// Confirmed items are already in the home repo, so clearing them loses nothing.
// The risk is the PENDING window: a device lost before docking cannot be read
// back. We never delete pending work; instead we cap how much can pile up
// (refuse, never truncate), and surface how much is at risk so the user docks.
export const MAX_OUTBOX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file
export const MAX_OUTBOX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB buffered
/** Warn once buffered work has waited this long unsynced. */
export const BUFFER_STALE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** Approximate byte size of a buffered item's inline content. */
export function itemBytes(item: OutboxItem): number {
  let total = 0;
  for (const f of item.files) {
    if (f.contentBase64) total += Math.floor((f.contentBase64.length * 3) / 4);
  }
  return total;
}

export interface BufferHealth {
  pendingCount: number;
  totalBytes: number;
  /** Age of the oldest unsynced item, ms; undefined if none pending. */
  oldestMs?: number;
  stale: boolean;
  overCap: boolean;
}

export function bufferHealth(items: OutboxItem[], now: number): BufferHealth {
  const pending = items.filter((i) => i.state !== 'confirmed');
  let totalBytes = 0;
  let oldest: number | undefined;
  for (const i of pending) {
    totalBytes += itemBytes(i);
    const age = now - Date.parse(i.createdAt);
    if (Number.isFinite(age) && (oldest === undefined || age > oldest)) oldest = age;
  }
  return {
    pendingCount: pending.length,
    totalBytes,
    oldestMs: oldest,
    stale: oldest !== undefined && oldest > BUFFER_STALE_MS,
    overCap: totalBytes > MAX_OUTBOX_TOTAL_BYTES,
  };
}

/** Would adding these bytes exceed a cap? Callers refuse rather than truncate. */
export function withinCaps(currentTotalBytes: number, addBytes: number, largestFileBytes: number): boolean {
  if (largestFileBytes > MAX_OUTBOX_FILE_BYTES) return false;
  return currentTotalBytes + addBytes <= MAX_OUTBOX_TOTAL_BYTES;
}
