// Deno tests for the entitlement gate. Run: `deno test _shared/entitlement.test.ts`.
// The edge functions have no runtime harness; this covers the pure decision core
// that the checkout/webhook logic leans on.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { effectiveTier, isEntitled, tierCoversSeats } from './entitlement.ts';

Deno.test('isEntitled: active and trialing grant access', () => {
  assertEquals(isEntitled({ status: 'active' }), true);
  assertEquals(isEntitled({ status: 'trialing' }), true);
});

Deno.test('isEntitled: revoked statuses deny access', () => {
  for (const status of [
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'paused',
  ]) {
    assertEquals(isEntitled({ status }), false, `status ${status} must be revoked`);
  }
});

Deno.test('isEntitled: missing entitlement is not entitled', () => {
  assertEquals(isEntitled(undefined), false);
  assertEquals(isEntitled(null), false);
});

Deno.test('isEntitled: lapsed validUntil denies even when active', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  assertEquals(isEntitled({ status: 'active', validUntil: past }), false);
  assertEquals(isEntitled({ status: 'active', validUntil: future }), true);
  assertEquals(isEntitled({ status: 'active', validUntil: null }), true);
});

Deno.test('effectiveTier: keeps tier while entitled, personal otherwise', () => {
  assertEquals(effectiveTier('commercial_small', 'active'), 'commercial_small');
  assertEquals(effectiveTier('commercial_small', 'trialing'), 'commercial_small');
  assertEquals(effectiveTier('commercial_small', 'past_due'), 'personal');
  assertEquals(effectiveTier('commercial_small', 'canceled'), 'personal');
});

Deno.test('tierCoversSeats: a plan must cover the seat count', () => {
  assertEquals(tierCoversSeats('commercial_micro', 5), true);
  assertEquals(tierCoversSeats('commercial_micro', 6), false);
  assertEquals(tierCoversSeats('commercial_micro', 500), false);
  assertEquals(tierCoversSeats('commercial_small', 30), true);
  assertEquals(tierCoversSeats('commercial_small', 31), false);
  assertEquals(tierCoversSeats('commercial_mid', 100), true);
  assertEquals(tierCoversSeats('commercial_large', 100000), true);
  assertEquals(tierCoversSeats('personal', 1), false);
  assertEquals(tierCoversSeats('nonsense', 1), false);
});
