// Provenance on agent-written notes (Vault M7, CTO L9, L10): flat, one-line
// `oscode-*` frontmatter keys, merged into a note's text byte for byte, so the
// person's own keys, comments, order and line endings are untouched. The merge
// runs BEFORE the diff preview (engine `vaultWrite`, app `vaultPropose`), so
// the person approves the exact bytes; Crew notes and "Mark as reviewed" use
// the same function.
//
// Wave 0 stub: the signatures are the contract; stream B builds the bodies.
// Both throw until then (a merge that silently returned the text unchanged
// would read as a note with no provenance). Pure and import-free past the
// vault core (harnessPurity); values are written with `yamlString`.

import type {
  Frontmatter,
  NoteProvenance,
  ProvKey,
  ProvenanceFields,
  ProvenanceMerge,
} from './types.js';

function notBuilt(name: string): never {
  throw new Error(`not built: ${name} (Vault M7, stream B)`);
}

/** The provenance keys in the order a new block writes them. */
export const PROV_KEYS: readonly ProvKey[] = Object.freeze([
  'oscode-source',
  'oscode-model',
  'oscode-where',
  'oscode-size',
  'oscode-provider',
  'oscode-created',
  'oscode-reviewed',
] as const);

/** Set (a string) or remove (`null`) each named provenance line in `text`
 *  (L10), keeping the BOM, the note's EOL and every other byte. */
export function mergeProvenance(_text: string, _fields: ProvenanceFields): ProvenanceMerge {
  return notBuilt('mergeProvenance');
}

/** A note's provenance from its parsed frontmatter. Reads only `oscode-*`
 *  keys, never `oscode:` (the M4 marks). */
export function readProvenance(_fm: Frontmatter): NoteProvenance {
  return notBuilt('readProvenance');
}
