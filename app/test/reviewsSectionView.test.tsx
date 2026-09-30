// The room on a model page, mounted, reading rows the way the public view
// sends them (CTO 11 package B): no author ids, the reader's own review known
// by is_mine, the "OpenShore team" label only where the server set is_staff,
// and Block naming the review, then reading the list again so the view drops
// the blocked author's reviews.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewRow } from '../src/lib/reviewsMath.js';
import type { Session } from '../src/lib/supabase.js';
import { mountDom, type TestDom } from './support/dom.js';

const h = vi.hoisted(() => ({
  rows: [] as ReviewRow[][],
  blocked: [] as Array<{ user: string; review: string }>,
  fetches: 0,
}));

vi.mock('../src/lib/reviews.js', () => ({
  REVIEW_EULA_VERSION: 'test',
  acceptEula: vi.fn(),
  deleteOwnReview: vi.fn(),
  hasAcceptedEula: vi.fn(async () => true),
  reportReview: vi.fn(async () => undefined),
  reviewsAvailable: () => true,
  submitReview: vi.fn(),
  fetchSummary: vi.fn(async () => ({
    model_id: 'm',
    count: 3,
    average: 4,
    dist: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
  })),
  fetchReviews: vi.fn(async () => {
    const answer = h.rows[Math.min(h.fetches, h.rows.length - 1)] ?? [];
    h.fetches += 1;
    return answer;
  }),
  blockUser: vi.fn(async (session: Session, reviewId: string) => {
    h.blocked.push({ user: session.user.id, review: reviewId });
  }),
}));

const row = (over: Partial<ReviewRow> & { id: string }): ReviewRow => ({
  model_id: 'm',
  rating: 4,
  created_at: '2026-09-29T00:00:00Z',
  ...over,
});

const me: Session = { accessToken: 't', refreshToken: 'r', expiresAt: 0, user: { id: 'me' } };
const model = { id: 'm', name: 'Model' } as unknown as import('os-code/protocol').CatalogModel;

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
  // CommunityStars counts up on a frame; linkedom has no frames.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  h.rows = [];
  h.blocked = [];
  h.fetches = 0;
});
afterEach(async () => {
  await dom.unmount();
});

async function show(session?: Session) {
  const { ReviewsSection } = await import('../src/components/ReviewsSection.js');
  await dom.render(
    <ReviewsSection model={model} session={session} showToast={() => {}} onNeedSignIn={() => {}} />,
  );
  await dom.settle();
}

describe('the room reads the public view', () => {
  it("marks the reader's own review by is_mine, and the team's by is_staff", async () => {
    h.rows = [
      [
        row({ id: 'mine', is_mine: true, body: 'my run' }),
        row({ id: 'staff', is_staff: true, body: 'team run' }),
        row({ id: 'other', body: 'their run' }),
      ],
    ];
    await show(me);
    const rows = [...dom.container.querySelectorAll('.review-row')];
    expect(rows.map((r) => r.querySelector('.review-mine')?.textContent ?? '')).toEqual([
      'You',
      '',
      '',
    ]);
    expect(rows.map((r) => r.querySelector('.review-staff')?.textContent ?? '')).toEqual([
      '',
      'OpenShore team',
      '',
    ]);
    expect(dom.buttons()).toContain('Edit your run report');
  });

  it('shows every visible review to a signed-out reader, none marked as theirs', async () => {
    h.rows = [[row({ id: 'a', body: 'one' }), row({ id: 'b', body: 'two' })]];
    await show(undefined);
    expect(dom.container.querySelectorAll('.review-row')).toHaveLength(2);
    expect(dom.container.querySelector('.review-mine')).toBeNull();
    expect(dom.buttons()).toContain('Add your run report');
  });

  it('blocks by the review, then reads the list again without the author', async () => {
    h.rows = [
      [row({ id: 'keep', body: 'kept' }), row({ id: 'theirs', body: 'blocked one' })],
      [row({ id: 'keep', body: 'kept' })],
    ];
    await show(me);
    const more = dom.container.querySelectorAll('.review-more')[1] as HTMLElement;
    await (async () => {
      const { act } = await import('react');
      await act(async () => {
        more.dispatchEvent(new window.Event('click', { bubbles: true }));
      });
    })();
    await dom.click('Block this user');
    await dom.settle();
    expect(h.blocked).toEqual([{ user: 'me', review: 'theirs' }]);
    expect(h.fetches).toBe(2);
    expect(dom.text()).not.toContain('blocked one');
    expect(dom.text()).toContain('kept');
  });
});
