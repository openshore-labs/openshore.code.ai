// Deno tests for push-send's session hash and push-unregister's request
// (security review 2026-10-01, follow-ups 2 and 3). Run: `deno test _shared/push.test.ts`.
import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  MAX_GRANT_IDS,
  claimMissing,
  hmacSha256Hex,
  parseUnregister,
  readClaim,
  sessionHashKey,
} from './push.ts';

const TOKEN = 'ab'.repeat(32);
const ID = '11111111-1111-4111-8111-111111111111';

Deno.test('sessionHashKey: a missing or short key counts as unset', () => {
  assertEquals(sessionHashKey(undefined), undefined);
  assertEquals(sessionHashKey(''), undefined);
  assertEquals(sessionHashKey('x'.repeat(31)), undefined);
  assertEquals(sessionHashKey('x'.repeat(32)), 'x'.repeat(32));
});

Deno.test('hmacSha256Hex: matches the RFC 4231 test case 2', async () => {
  assertEquals(
    await hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  );
});

Deno.test('hmacSha256Hex: the stored form never holds the session id', async () => {
  const key = 'k'.repeat(32);
  const hashed = await hmacSha256Hex(key, 'a1b2c3d4');
  assertEquals(/^[0-9a-f]{64}$/.test(hashed), true);
  assertEquals(hashed.includes('a1b2c3d4'), false);
  assertNotEquals(hashed, await hmacSha256Hex('j'.repeat(32), 'a1b2c3d4'));
});

Deno.test('parseUnregister: a token, grant ids, or all', () => {
  assertEquals(parseUnregister({ token: TOKEN }), {
    ok: true,
    token: TOKEN,
    grantIds: [],
    all: false,
  });
  assertEquals(parseUnregister({ grantIds: [ID] }), { ok: true, grantIds: [ID], all: false });
  assertEquals(parseUnregister({ all: true }), { ok: true, grantIds: [], all: true });
});

Deno.test('parseUnregister: refuses an empty or malformed request', () => {
  for (const body of [
    {},
    null,
    'all',
    { all: 'yes' },
    { token: 'not-a-token' },
    { token: 42 },
    { grantIds: 'abc' },
    { grantIds: ['not-a-uuid'] },
    { grantIds: Array.from({ length: MAX_GRANT_IDS + 1 }, () => ID) },
  ]) {
    assertEquals(parseUnregister(body).ok, false, JSON.stringify(body));
  }
});

Deno.test('readClaim: only push_send_claim\'s four answers', () => {
  assertEquals(readClaim('sent'), 'sent');
  assertEquals(readClaim('throttled'), 'throttled');
  assertEquals(readClaim('cooled'), 'cooled');
  assertEquals(readClaim('deduped'), 'deduped');
  assertEquals(readClaim('ok'), undefined);
  assertEquals(readClaim(null), undefined);
  assertEquals(readClaim(['sent']), undefined);
});

Deno.test('claimMissing: an unknown function, never another failure', () => {
  assertEquals(claimMissing({ code: 'PGRST202', message: 'Could not find the function' }), true);
  assertEquals(claimMissing({ code: '42883', message: 'function does not exist' }), true);
  assertEquals(
    claimMissing({ message: 'Could not find the function public.push_send_claim in the schema cache' }),
    true,
  );
  assertEquals(claimMissing({ code: '22023', message: 'push_send_claim: bad arguments' }), false);
  assertEquals(claimMissing({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
  assertEquals(claimMissing(null), false);
});
