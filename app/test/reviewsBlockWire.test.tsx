// Block this user through the real client (CTO 11 package B, review
// 2026-09-30). block_review_author (production's 0020) returns void, and
// PostgREST answers a void function with 204 and no body (checked on the
// CLI's pinned postgrest v16.3). The client once read every RPC answer with
// res.json(), which throws on an empty body, so a block that was saved showed
// the parser's message as a toast and the list never reloaded. Here the room,
// the reviews client and the Supabase client are all real; only fetch is a
// stand-in that answers the way PostgREST does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewRow } from '../src/lib/reviewsMath.js';
import type { Session } from '../src/lib/supabase.js';
import { mountDom, type TestDom } from './support/dom.js';

vi.stubEnv('VITE_SUPABASE_URL', 'https://sb.test');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');

// Reviews are shut on every build (REVIEWS_OPEN, since production's 0027
// revoked review writes), so the room renders nothing. This test opens that
// one door and keeps the rest of the client real, so the wire stays proven
// for the day a migration grants writes back.
vi.mock('../src/lib/reviews.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/reviews.js')>()),
  reviewsAvailable: () => true,
}));

const reviews = await import('../src/lib/reviews.js');
const supabase = await import('../src/lib/supabase.js');

const me: Session = {
  accessToken: 'live',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'me' },
};
const model = { id: 'm', name: 'Model' } as unknown as import('os-code/protocol').CatalogModel;

const row = (id: string, body: string): ReviewRow => ({
  id,
  model_id: 'm',
  rating: 4,
  body,
  created_at: '2026-09-29T00:00:00Z',
});

/** What the stand-in server has seen, and whether the block has landed. */
let seen: string[];
let blocked: boolean;

function postgrest(url: string, init?: RequestInit): Response {
  const path = new URL(url).pathname;
  seen.push(`${init?.method ?? 'GET'} ${path}`);
  if (path === '/rest/v1/rpc/block_review_author') {
    blocked = true;
    return new Response(null, { status: 204 });
  }
  // Another void function, reached through the signed-in rpc().
  if (path === '/rest/v1/rpc/delete_org_project') return new Response(null, { status: 204 });
  if (path === '/rest/v1/rpc/model_review_summary') {
    return Response.json({ count: blocked ? 1 : 2, average: 4, dist: { 4: blocked ? 1 : 2 } });
  }
  if (path === '/rest/v1/model_reviews_public') {
    return Response.json(
      blocked ? [row('keep', 'kept')] : [row('keep', 'kept'), row('theirs', 'blocked one')],
    );
  }
  return Response.json([]);
}

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  seen = [];
  blocked = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => postgrest(url, init)),
  );
  reviews.setReviewsAuth(async () => me);
});
afterEach(async () => {
  await dom.unmount();
  vi.unstubAllGlobals();
});

describe('a void RPC through the real client', () => {
  it('reads 204 No Content as done, not as a parse error', async () => {
    await expect(reviews.blockUser(me, 'theirs')).resolves.toBeUndefined();
    expect(seen).toEqual(['POST /rest/v1/rpc/block_review_author']);
    // rpcPublic reads it that way directly, and so does the signed-in rpc()
    // (delete_org_project, the team vault's org_vault_delete and the other
    // void functions).
    await expect(supabase.rpcPublic('block_review_author', {}, 'live')).resolves.toBeUndefined();
    await expect(supabase.rpc('delete_org_project', 'live', {})).resolves.toBeUndefined();
  });

  it('still reads a JSON answer, and still throws a refusal', async () => {
    expect(await supabase.rpcPublic('model_review_summary', {}, 'live')).toMatchObject({
      count: 2,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ code: 'P0001', message: 'review not found' }, { status: 400 }),
      ),
    );
    await expect(reviews.blockUser(me, 'gone')).rejects.toThrow('review not found');
  });
});

describe('Block this user in the room', () => {
  it('blocks, reads the list again without the author, and says so', async () => {
    const toasts: string[] = [];
    const { ReviewsSection } = await import('../src/components/ReviewsSection.js');
    await dom.render(
      <ReviewsSection
        model={model}
        session={me}
        showToast={(m) => toasts.push(m)}
        onNeedSignIn={() => {}}
      />,
    );
    await dom.settle();
    expect(dom.text()).toContain('blocked one');
    const more = dom.container.querySelectorAll('.review-more')[1] as HTMLElement;
    const { act } = await import('react');
    await act(async () => {
      more.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    await dom.click('Block this user');
    await dom.settle();
    expect(seen).toContain('POST /rest/v1/rpc/block_review_author');
    expect(toasts).toEqual(['Blocked. You will not see their reviews.']);
    expect(dom.text()).not.toContain('blocked one');
    expect(dom.text()).toContain('kept');
  });
});
