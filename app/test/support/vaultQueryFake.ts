// A fake of stream A1's query core (Vault M6, tech review K8), to its contract, for
// the search UI's tests while the real one is a stub in this tree:
// whitespace clauses, quoted phrases, tag:, path:, file:, `#x` as tag:x, a
// leading `-` negates, the last bare term a prefix.
import type { TextRange, VaultQuery, VaultQueryClause } from 'os-code/protocol';
import { cleanRanges } from '../../src/lib/vaultSearch.js';

const fold = (s: string) => s.normalize('NFC').toLowerCase();

/** Whitespace clauses, quoted phrases, tag:/path:/file:, `#x` as tag:x, a
 *  leading `-` negates, the last bare term a prefix. */
export function fakeParse(q: string): VaultQuery {
  const clauses: VaultQueryClause[] = [];
  const re = /(-?)(?:(tag|path|file):)?(?:"([^"]*)"?|(\S+))/g;
  let lastBare: string | undefined;
  for (const m of q.matchAll(re)) {
    const negated = m[1] === '-';
    const op = m[2] as 'tag' | 'path' | 'file' | undefined;
    const quoted = m[3];
    let value = fold(quoted ?? m[4] ?? '');
    if (!value) continue;
    if (op) {
      if (op === 'tag') value = value.replace(/^#/, '');
      clauses.push({ kind: op, value, negated });
      lastBare = undefined;
    } else if (quoted !== undefined) {
      clauses.push({ kind: 'phrase', value, negated });
      lastBare = undefined;
    } else if (value.startsWith('#') && value.length > 1) {
      clauses.push({ kind: 'tag', value: value.slice(1), negated });
      lastBare = undefined;
    } else {
      clauses.push({ kind: 'term', value, negated });
      lastBare = negated ? undefined : value;
    }
  }
  const filtersOnly =
    clauses.length > 0 &&
    clauses.every((c) => c.kind === 'tag' || c.kind === 'path' || c.kind === 'file');
  return { clauses, ...(lastBare ? { prefix: lastBare } : {}), filtersOnly };
}

export function fakeRanges(text: string, query: VaultQuery): TextRange[] {
  const hay = fold(text);
  const out: TextRange[] = [];
  for (const c of query.clauses) {
    if (c.negated || (c.kind !== 'term' && c.kind !== 'phrase')) continue;
    for (let i = hay.indexOf(c.value); i !== -1; i = hay.indexOf(c.value, i + c.value.length)) {
      out.push({ start: i, end: i + c.value.length });
    }
  }
  return cleanRanges(text, out);
}
