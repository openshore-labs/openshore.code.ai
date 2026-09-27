// Link rewrites for a set of moves (Vault M6, CTO K4 with R1): a pure plan the
// host applies one compare-and-swap write at a time. A link is spliced only
// when its resolution from the source's new path against `after` would differ
// from the moved target, so every other byte stays (aliases, `#Heading`,
// `#^block`, the `!` kept). Attachments are in `moves` for a folder move.
// `rewriteLinks` (rewrite.ts) stays as the one-move wrapper.
//
// Wave 0 stub: the signatures are the contract; stream A2 builds the bodies.
// Pure and import-free past the vault core.

import type {
  LinkRewritePlan,
  LinkRewriteSource,
  MoveSourcePaths,
  RewriteResult,
  VaultPathIndex,
} from './types.js';

function notBuilt(name: string): never {
  throw new Error(`not built: ${name} (Vault M6, stream A2)`);
}

/** Rewrite one note's links for every move in `moves` (old path to new).
 *  `source` is the note's own path before and after (the same when it did not
 *  move). */
export function rewriteForMoves(
  _text: string,
  _source: MoveSourcePaths,
  _moves: ReadonlyMap<string, string>,
  _before: VaultPathIndex,
  _after: VaultPathIndex,
): RewriteResult {
  return notBuilt('rewriteForMoves');
}

/** Plan every rewrite the moves need over the sources the host read (from
 *  the index only: backlinks of every moved path, the moved notes, and
 *  backlinks of notes sharing a moved note's new basename key). */
export function planLinkRewrites(
  _moves: ReadonlyMap<string, string>,
  _before: VaultPathIndex,
  _after: VaultPathIndex,
  _sources: ReadonlyArray<LinkRewriteSource>,
): LinkRewritePlan {
  return notBuilt('planLinkRewrites');
}
