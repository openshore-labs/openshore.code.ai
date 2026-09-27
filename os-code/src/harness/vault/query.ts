// The Vault's search grammar (Vault M6, CTO K8): whitespace-separated clauses;
// `"a phrase"`; `tag:x` or `tag:#x` (matches `x` and `x/...`); `path:x`;
// `file:x` (`.md` optional); a quoted value; a leading `-` negates any clause.
// Anything else, `foo:bar` included, is plain terms. `#idea` means `tag:idea`
// (CX X1). No OR, parentheses, regex, `line:`, `section:` or `task:` in v1.
//
// Wave 0 stub: the signatures are the contract; stream A1 builds the bodies.
// Pure and import-free past the vault core.

import type { TextRange, VaultQuery } from './types.js';

function notBuilt(name: string): never {
  throw new Error(`not built: ${name} (Vault M6, stream A1)`);
}

/** Parse what the person typed into clauses. Never throws on any input. */
export function parseVaultQuery(_q: string): VaultQuery {
  return notBuilt('parseVaultQuery');
}

/** Where the query's positive terms, prefix and phrases match in `text`, in
 *  order and never overlapping, for `<mark>` elements (never an HTML
 *  string). */
export function highlightRanges(_text: string, _query: VaultQuery): TextRange[] {
  return notBuilt('highlightRanges');
}
