// Community reviews read production's public view (tech review 11 package B; the
// privacy branch's port). Production's 0020 took anon reads off model_reviews
// and leaves a signed-in reader only their own rows there, so a build that
// read the base table showed signed-out readers no reviews and signed-in
// readers only their own. Every list now reads model_reviews_public: visible
// rows, the reader's blocks applied, no author id, the server's staff flag and
// is_mine. Blocking names the review, and the server finds its author
// (block_review_author).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/lib/supabase.js';

const h = vi.hoisted(() => ({
  selectPublic: vi.fn(async (): Promise<unknown[]> => []),
  rpcPublic: vi.fn(async (): Promise<unknown> => null),
  insert: vi.fn(async () => undefined),
}));

vi.mock('../src/lib/supabase.js', () => ({
  del: vi.fn(),
  insert: h.insert,
  isConfigured: () => true,
  rpcPublic: h.rpcPublic,
  selectPublic: h.selectPublic,
  upsert: vi.fn(),
}));

const reviews = await import('../src/lib/reviews.js');

const me: Session = { accessToken: 'held', refreshToken: 'r', expiresAt: 0, user: { id: 'me' } };

beforeEach(() => {
  h.selectPublic.mockClear();
  h.rpcPublic.mockClear();
  h.insert.mockClear();
  reviews.setReviewsAuth(async () => ({ ...me, accessToken: 'live' }));
});

describe('reviews are shut', () => {
  // Production's 0027 revoked review writes, so the Local Library (a v1 room
  // since 2026-10-11) shows no review surface until a migration grants them
  // back, even on a build with a backend.
  it('keeps every review surface off while REVIEWS_OPEN is false', () => {
    expect(reviews.REVIEWS_OPEN).toBe(false);
    expect(reviews.reviewsAvailable()).toBe(false);
  });
});

describe('reading reviews', () => {
  it('reads the public view, never the base table, with no author id', async () => {
    await reviews.fetchReviews('qwen2.5:7b');
    const [table, query, token] = h.selectPublic.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
    ];
    expect(table).toBe('model_reviews_public');
    const cols = /select=([^&]+)/.exec(query)![1].split(',');
    expect(cols).not.toContain('user_id');
    expect(cols).toEqual(expect.arrayContaining(['id', 'rating', 'is_staff', 'is_mine']));
    expect(query).toContain('model_id=eq.qwen2.5%3A7b');
    // Signed out: no token, and the view still answers (anon holds select).
    expect(token).toBeUndefined();
  });

  it("passes a signed-in reader's live token, so the view applies their blocks and marks their own", async () => {
    await reviews.fetchReviews('m', me);
    expect(h.selectPublic).toHaveBeenCalledWith('model_reviews_public', expect.any(String), 'live');
  });

  it('never selects user_id from the reviews anywhere in the read path', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'reviews.ts'), 'utf8');
    const cols = /const REVIEW_COLS =\s*'([^']+)'/.exec(src)![1];
    expect(cols.split(',')).not.toContain('user_id');
    expect(src).toMatch(/selectPublic<ReviewRow>\(REVIEWS_PUBLIC, q, token\)/);
  });
});

describe('blocking', () => {
  it('names the review, and the server looks up and blocks its author', async () => {
    await reviews.blockUser(me, 'review-7');
    expect(h.rpcPublic).toHaveBeenCalledWith(
      'block_review_author',
      { p_review_id: 'review-7' },
      'live',
    );
    expect(h.insert).not.toHaveBeenCalled();
  });

  it('asks the person to sign in when there is no live session', async () => {
    reviews.setReviewsAuth(async () => undefined);
    await expect(reviews.blockUser(me, 'review-7')).rejects.toThrow('Sign in to block a user.');
    expect(h.rpcPublic).not.toHaveBeenCalled();
  });
});
