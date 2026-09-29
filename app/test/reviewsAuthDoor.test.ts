// Reviews and the abuse review queue used to refresh the session through
// freshSession themselves, so the store's memory never learned the new token
// and a second refresher could race the store's own. They now go through the
// store's one door (setReviewsAuth, setAbuseReviewAuth), the pattern the
// guardrail record uses (setEthicsAuth).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/lib/supabase.js';

const h = vi.hoisted(() => ({
  upsert: vi.fn(async () => undefined),
  rpcPublic: vi.fn(async (): Promise<unknown> => true),
  freshSession: vi.fn(async (s: unknown) => s),
}));

vi.mock('../src/lib/supabase.js', () => ({
  del: vi.fn(),
  insert: vi.fn(),
  isConfigured: () => true,
  rpcPublic: h.rpcPublic,
  selectPublic: vi.fn(async () => []),
  upsert: h.upsert,
}));
vi.mock('../src/lib/authSession.js', () => ({ freshSession: h.freshSession }));

const reviews = await import('../src/lib/reviews.js');
const abuse = await import('../src/lib/abuseReview.js');

const held: Session = {
  accessToken: 'stale',
  refreshToken: 'r1',
  expiresAt: 0,
  user: { id: 'me' },
};
const live: Session = { ...held, accessToken: 'live-from-the-store', refreshToken: 'r2' };

describe("reviews and the abuse queue ride the store's session", () => {
  beforeEach(() => {
    h.upsert.mockClear();
    h.rpcPublic.mockClear();
    h.freshSession.mockClear();
  });

  it("a review is written with the store's live token, and nothing refreshes on its own", async () => {
    const door = vi.fn(async () => live);
    reviews.setReviewsAuth(door);
    await reviews.submitReview(held, { modelId: 'qwen2.5:7b', rating: 5 });
    expect(door).toHaveBeenCalledTimes(1);
    expect(h.upsert).toHaveBeenCalledWith(
      'model_reviews',
      'live-from-the-store',
      expect.objectContaining({ user_id: 'me' }),
      'user_id,model_id',
    );
    expect(h.freshSession).not.toHaveBeenCalled();
  });

  it("never writes with another person's token, or signed out", async () => {
    reviews.setReviewsAuth(async () => ({ ...live, user: { id: 'someone-else' } }));
    await expect(reviews.submitReview(held, { modelId: 'm', rating: 4 })).rejects.toThrow(
      'Sign in to write a review.',
    );
    reviews.setReviewsAuth(async () => undefined);
    await expect(reviews.submitReview(held, { modelId: 'm', rating: 4 })).rejects.toThrow(
      'Sign in to write a review.',
    );
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("the abuse queue asks the server with the store's live token", async () => {
    abuse.setAbuseReviewAuth(async () => live);
    expect(await abuse.isAbuseReviewer(held)).toBe(true);
    expect(h.rpcPublic).toHaveBeenCalledWith('is_abuse_reviewer', {}, 'live-from-the-store');
    expect(h.freshSession).not.toHaveBeenCalled();
    abuse.setAbuseReviewAuth(async () => ({ ...live, user: { id: 'someone-else' } }));
    expect(await abuse.isAbuseReviewer(held)).toBe(false);
  });

  it('the store wires both doors to its own freshAuth', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const store = readFileSync(join(process.cwd(), 'src', 'state', 'store.ts'), 'utf8');
    expect(store).toContain('setReviewsAuth(() => freshAuth());');
    expect(store).toContain('setAbuseReviewAuth(() => freshAuth());');
    for (const file of ['reviews.ts', 'abuseReview.ts']) {
      const src = readFileSync(join(process.cwd(), 'src', 'lib', file), 'utf8');
      expect(src, file).not.toMatch(/freshSession/);
    }
  });
});
