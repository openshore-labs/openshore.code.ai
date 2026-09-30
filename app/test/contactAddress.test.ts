// One published address (founder decision F1, 2026-09-30: support@openshore.ai
// passed its round-trip test). The engine's SUPPORT_EMAIL is the one
// constant: the block card's appeal line and the Delete account sheet read it.
// Two places cannot import it, the server's enforcement ladder (the newest
// record_enforcement, which production shows a warned person) and the Terms,
// so this fails the moment either says a different address. Switching it again
// is this constant, the Terms, and a new migration for the ladder (an applied
// migration is never edited).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOCK_NEXT_ACTION, SUPPORT_EMAIL } from 'os-code/protocol';
import { DELETE_ACCOUNT_COPY, SUPPORT_MAILTO } from '../src/components/DeleteAccount.js';

const ROOT = join(process.cwd(), '..');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function newestRecordEnforcement(): string {
  const dir = join(ROOT, 'supabase', 'migrations');
  const head = 'create or replace function public.record_enforcement ()';
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .filter((text) => text.includes(head))
    .pop()!;
  const start = sql.indexOf(head);
  return sql.slice(start, sql.indexOf('$$;', start));
}

describe('the one published address', () => {
  it('is support@openshore.ai, the F1 ruling', () => {
    expect(SUPPORT_EMAIL).toBe('support@openshore.ai');
  });

  it('is what the block card and the Delete account sheet say', () => {
    expect(BLOCK_NEXT_ACTION).toContain(SUPPORT_EMAIL);
    expect(DELETE_ACCOUNT_COPY.ownsOrgBody).toContain(SUPPORT_EMAIL);
    expect(SUPPORT_MAILTO).toBe(`mailto:${SUPPORT_EMAIL}`);
    const sheet = readFileSync(
      join(process.cwd(), 'src', 'components', 'DeleteAccount.tsx'),
      'utf8',
    );
    expect(sheet.match(EMAIL) ?? []).toEqual([]);
  });

  it('is the only address in the server ladder the person is warned with', () => {
    const body = newestRecordEnforcement();
    expect(body).toContain(`write to ${SUPPORT_EMAIL}.`);
    expect([...new Set(body.match(EMAIL))]).toEqual([SUPPORT_EMAIL]);
  });

  it('is the only address in the Terms', () => {
    const terms = readFileSync(join(ROOT, 'docs', 'terms-of-use.md'), 'utf8');
    expect([...new Set(terms.match(EMAIL))]).toEqual([SUPPORT_EMAIL]);
  });
});
