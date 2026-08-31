// Money-safety guard: the commercial seat bands are defined twice on purpose
// (app/src/lib/plans.ts for the UI, supabase/functions/_shared/entitlement.ts
// for the server-side seat check, which cannot import app code). If the two
// drift, a client could be shown one band and charged against another. This
// fails the build the moment the ids or seat ceilings diverge, so the hand
// mirror can never rot silently. Reads the edge file as text because it is Deno,
// not importable into this Node test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMERCIAL_TIERS } from '../src/lib/plans.js';

function serverBands(): Array<{ id: string; maxEmployees: number | null }> {
  const src = readFileSync(
    join(process.cwd(), '..', 'supabase', 'functions', '_shared', 'entitlement.ts'),
    'utf8',
  );
  const block = src.slice(
    src.indexOf('COMMERCIAL_BANDS'),
    src.indexOf('];', src.indexOf('COMMERCIAL_BANDS')),
  );
  const re = /\{\s*id:\s*'([^']+)',\s*maxEmployees:\s*(null|\d+)\s*\}/g;
  const out: Array<{ id: string; maxEmployees: number | null }> = [];
  for (let m = re.exec(block); m; m = re.exec(block)) {
    out.push({ id: m[1]!, maxEmployees: m[2] === 'null' ? null : Number(m[2]) });
  }
  return out;
}

describe('commercial band mirror', () => {
  it('server bands match plans.ts exactly (id and seat ceiling, in order)', () => {
    const server = serverBands();
    const app = COMMERCIAL_TIERS.map((t) => ({ id: t.id, maxEmployees: t.maxEmployees }));
    expect(server).toEqual(app);
  });
});
