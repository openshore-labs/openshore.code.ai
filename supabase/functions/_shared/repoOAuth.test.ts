// Deno tests for repo-oauth's sign-in switch (CTO security review,
// 2026-10-21). Run: `deno test _shared/repoOAuth.test.ts`.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { requireSignIn, signedIn } from './repoOAuth.ts';

Deno.test('requireSignIn: on only when the secret says true or 1', () => {
  assertEquals(requireSignIn('true'), true);
  assertEquals(requireSignIn(' TRUE '), true);
  assertEquals(requireSignIn('1'), true);
  assertEquals(requireSignIn(undefined), false);
  assertEquals(requireSignIn(''), false);
  assertEquals(requireSignIn('false'), false);
  assertEquals(requireSignIn('0'), false);
  assertEquals(requireSignIn('yes please'), false);
});

function fakeFetch(status: number, seen: { url?: string; headers?: HeadersInit }[]) {
  return ((url: string, init?: RequestInit) => {
    seen.push({ url, headers: init?.headers });
    return Promise.resolve(new Response('{}', { status }));
  }) as typeof fetch;
}

Deno.test('signedIn: asks the auth server about the bearer, and only that', async () => {
  const seen: { url?: string; headers?: HeadersInit }[] = [];
  assertEquals(await signedIn('Bearer abc.def', 'https://p.supabase.co/', 'anon', fakeFetch(200, seen)), true);
  assertEquals(seen[0].url, 'https://p.supabase.co/auth/v1/user');
  assertEquals(seen[0].headers, { authorization: 'Bearer abc.def', apikey: 'anon' });
});

Deno.test('signedIn: a refused, missing or malformed token is not signed in', async () => {
  const seen: { url?: string; headers?: HeadersInit }[] = [];
  assertEquals(await signedIn('Bearer abc', 'https://p.supabase.co', 'anon', fakeFetch(401, seen)), false);
  assertEquals(await signedIn(null, 'https://p.supabase.co', 'anon', fakeFetch(200, seen)), false);
  assertEquals(await signedIn('Basic abc', 'https://p.supabase.co', 'anon', fakeFetch(200, seen)), false);
  assertEquals(await signedIn('Bearer ', 'https://p.supabase.co', 'anon', fakeFetch(200, seen)), false);
  assertEquals(await signedIn('Bearer abc', '', 'anon', fakeFetch(200, seen)), false);
  assertEquals(seen.length, 1);
  const offline = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
  assertEquals(await signedIn('Bearer abc', 'https://p.supabase.co', 'anon', offline), false);
});
