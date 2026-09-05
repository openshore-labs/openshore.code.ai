// BE-6: an author's review payload carries exactly the columns the server
// grants an author (migration 0015). `status`, `flag_count`, and `created_at`
// belong to moderation; a payload carrying one of them is refused by the
// column grant, so this pins the shape at the source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({
  del: vi.fn(),
  insert: vi.fn(),
  isConfigured: () => true,
  rpcPublic: vi.fn(),
  selectPublic: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('../src/lib/authSession.js', () => ({
  freshSession: async (s: unknown) => s,
}));

import { reviewPayload } from '../src/lib/reviews.js';

const MODERATION_OWNED = ['status', 'flag_count', 'created_at', 'id'];

/** The column list inside `grant insert (...) on public.model_reviews` in 0015. */
function grantedInsertColumns(): string[] {
  const src = readFileSync(
    join(process.cwd(), '..', 'supabase', 'migrations', '0015_review_2026_09_05.sql'),
    'utf8',
  );
  const m = /grant insert \(([^)]+)\)\s+on public\.model_reviews/s.exec(src);
  if (!m) throw new Error('model_reviews insert grant not found in 0015');
  return m[1]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('reviewPayload', () => {
  const payload = reviewPayload(
    'user-1',
    { modelId: 'qwen', rating: 4, body: ' nice ', useCases: ['coding'] },
    new Date('2026-09-05T00:00:00Z'),
  );

  it('never carries a moderation-owned column', () => {
    for (const col of MODERATION_OWNED) expect(payload).not.toHaveProperty(col);
  });

  it('sends only columns the 0015 insert grant allows', () => {
    const allowed = new Set(grantedInsertColumns());
    for (const key of Object.keys(payload)) {
      expect(allowed.has(key), `column ${key} is not in the insert grant`).toBe(true);
    }
  });

  it('keeps the reviewer id from the session and trims text fields', () => {
    expect(payload.user_id).toBe('user-1');
    expect(payload.body).toBe('nice');
    expect(payload.updated_at).toBe('2026-09-05T00:00:00.000Z');
  });
});
