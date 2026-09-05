// Deno tests for the entitlement gate. Run: `deno test _shared/entitlement.test.ts`.
// The edge functions have no runtime harness; this covers the pure decision core
// that the checkout/webhook logic leans on.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  APPLE_JWS_MAX_AGE_MS,
  appleLinkRefusal,
  appleTransactionAccepted,
  checkoutDecision,
  effectiveTier,
  isEntitled,
  isIgnoredPrice,
  parseIdList,
  shouldApplyRailWrite,
  statusFromTransaction,
  tierCoversSeats,
} from './entitlement.ts';

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

// ------------------------------------------------------------ rail writes

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-05T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

Deno.test('shouldApplyRailWrite: no existing row always applies', () => {
  assertEquals(
    shouldApplyRailWrite(null, { source: 'stripe', validUntil: iso(T0 + DAY), eventMs: T0 }),
    true,
  );
});

Deno.test('shouldApplyRailWrite: a stale or duplicate event is dropped', () => {
  const existing = { source: 'stripe', status: 'active', last_event_at: iso(T0) };
  assertEquals(
    shouldApplyRailWrite(existing, { source: 'stripe', validUntil: null, eventMs: T0 }),
    false,
  );
  assertEquals(
    shouldApplyRailWrite(existing, { source: 'stripe', validUntil: null, eventMs: T0 - 1 }),
    false,
  );
  assertEquals(
    shouldApplyRailWrite(existing, { source: 'stripe', validUntil: null, eventMs: T0 + 1 }),
    true,
  );
});

Deno.test('shouldApplyRailWrite (BE-3): an old Stripe period-end delete cannot revoke a live Apple year', () => {
  const existing = {
    source: 'apple',
    status: 'active',
    valid_until: iso(T0 + 300 * DAY),
    last_event_at: iso(T0 - 10 * DAY),
  };
  // Stripe's `deleted` event carries the period end that just lapsed.
  assertEquals(
    shouldApplyRailWrite(existing, { source: 'stripe', validUntil: iso(T0), eventMs: T0 }),
    false,
  );
});

Deno.test('shouldApplyRailWrite: an Apple event cannot shorten a longer live Stripe window', () => {
  const existing = {
    source: 'stripe',
    status: 'active',
    valid_until: iso(T0 + 300 * DAY),
    last_event_at: iso(T0 - DAY),
  };
  assertEquals(
    shouldApplyRailWrite(existing, { source: 'apple', validUntil: iso(T0 + 30 * DAY), eventMs: T0 }),
    false,
  );
  // The longer window wins, whichever rail holds it.
  assertEquals(
    shouldApplyRailWrite(existing, { source: 'apple', validUntil: iso(T0 + 400 * DAY), eventMs: T0 }),
    true,
  );
});

Deno.test('shouldApplyRailWrite: the other rail may write over a revoked or lapsed row', () => {
  const canceled = { source: 'stripe', status: 'canceled', valid_until: iso(T0 + 300 * DAY) };
  assertEquals(
    shouldApplyRailWrite(canceled, { source: 'apple', validUntil: iso(T0 + DAY), eventMs: T0 }),
    true,
  );
  const lapsed = { source: 'apple', status: 'active', valid_until: iso(T0 - DAY) };
  assertEquals(
    shouldApplyRailWrite(lapsed, { source: 'stripe', validUntil: iso(T0 + DAY), eventMs: T0 }),
    true,
  );
});

Deno.test('shouldApplyRailWrite: same-rail writes skip the cross-rail guard', () => {
  const existing = { source: 'stripe', status: 'active', valid_until: iso(T0 + 300 * DAY) };
  // A same-rail cancel with a shorter window (the real cancel case) applies.
  assertEquals(
    shouldApplyRailWrite(existing, { source: 'stripe', validUntil: iso(T0), eventMs: T0 }),
    true,
  );
});

// ------------------------------------------------------------ Apple

Deno.test('statusFromTransaction: revoked, lapsed, else active', () => {
  assertEquals(statusFromTransaction({ revocationDate: T0 - 1 }, T0), 'canceled');
  assertEquals(statusFromTransaction({ expiresDate: T0 - 1 }, T0), 'canceled');
  assertEquals(statusFromTransaction({ expiresDate: T0 }, T0), 'canceled');
  assertEquals(statusFromTransaction({ expiresDate: T0 + 1 }, T0), 'active');
  assertEquals(statusFromTransaction({}, T0), 'active');
});

Deno.test('parseIdList: trims, drops blanks, unset is empty', () => {
  assertEquals([...parseIdList(' a, b ,,c ')], ['a', 'b', 'c']);
  assertEquals(parseIdList(undefined).size, 0);
  assertEquals(parseIdList('').size, 0);
});

Deno.test('appleTransactionAccepted (BE-9): only the named auto-renewable product', () => {
  const allowed = new Set(['ai.openshore.oscode.personal.yearly']);
  const sub = { productId: 'ai.openshore.oscode.personal.yearly', type: 'Auto-Renewable Subscription' };
  assertEquals(appleTransactionAccepted(sub, allowed), true);
  assertEquals(appleTransactionAccepted({ ...sub, type: 'Non-Consumable' }, allowed), false);
  assertEquals(appleTransactionAccepted({ ...sub, type: 'Consumable' }, allowed), false);
  assertEquals(appleTransactionAccepted({ ...sub, productId: 'ai.openshore.other' }, allowed), false);
  assertEquals(appleTransactionAccepted({ type: sub.type }, allowed), false);
  // Fail closed: an unset APPLE_PRODUCT_IDS accepts nothing.
  assertEquals(appleTransactionAccepted(sub, new Set()), false);
});

Deno.test('appleLinkRefusal (BE-4): a JWS older than 48h is refused before anything else', () => {
  assertEquals(appleLinkRefusal(null, T0 - APPLE_JWS_MAX_AGE_MS - 1, T0), 'too-old');
  assertEquals(appleLinkRefusal(null, T0 - APPLE_JWS_MAX_AGE_MS + 1000, T0), undefined);
});

Deno.test('appleLinkRefusal (BE-4): a refunded or revoked link never grants', () => {
  assertEquals(appleLinkRefusal({ status: 'refunded' }, T0, T0), 'revoked');
  assertEquals(appleLinkRefusal({ status: 'revoked', last_event_at: iso(T0 - DAY) }, T0, T0), 'revoked');
});

Deno.test('appleLinkRefusal (BE-4): a JWS not newer than the last Apple event is stale', () => {
  const link = { status: 'active', last_event_at: iso(T0) };
  assertEquals(appleLinkRefusal(link, T0, T0 + 1000), 'stale');
  assertEquals(appleLinkRefusal(link, T0 - 1000, T0 + 1000), 'stale');
  assertEquals(appleLinkRefusal(link, T0 + 1000, T0 + 2000), undefined);
  // A link with no recorded event yet (pre-0015 rows) accepts a fresh JWS.
  assertEquals(appleLinkRefusal({ status: null, last_event_at: null }, T0, T0), undefined);
});

// ------------------------------------------------------------ checkout

Deno.test('checkoutDecision (BE-7): any live sub routes to the portal', () => {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused']) {
    const d = checkoutDecision([{ id: 'sub_1', status }]);
    assertEquals(d.action, 'portal', `status ${status} must route to the portal`);
  }
});

Deno.test('checkoutDecision (BE-7): an abandoned incomplete sub is canceled, then checkout proceeds', () => {
  const d = checkoutDecision([
    { id: 'sub_old', status: 'canceled' },
    { id: 'sub_stuck', status: 'incomplete' },
  ]);
  assertEquals(d.action, 'cancel-then-checkout');
  if (d.action === 'cancel-then-checkout') assertEquals(d.cancel.map((s) => s.id), ['sub_stuck']);
});

Deno.test('checkoutDecision (BE-7): a live sub wins over a stuck one', () => {
  const d = checkoutDecision([
    { id: 'sub_stuck', status: 'incomplete' },
    { id: 'sub_live', status: 'past_due' },
  ]);
  assertEquals(d.action, 'portal');
  if (d.action === 'portal') assertEquals(d.sub.id, 'sub_live');
});

Deno.test('checkoutDecision (BE-7): dead subs start clean', () => {
  assertEquals(checkoutDecision([]).action, 'checkout');
  assertEquals(
    checkoutDecision([
      { id: 'a', status: 'canceled' },
      { id: 'b', status: 'incomplete_expired' },
    ]).action,
    'checkout',
  );
});

// ------------------------------------------------------------ prices

Deno.test('isIgnoredPrice (BE-13): only a listed price is ignored', () => {
  const ignored = parseIdList('price_legacy_1, price_legacy_2');
  assertEquals(isIgnoredPrice('price_legacy_1', ignored), true);
  assertEquals(isIgnoredPrice('price_unknown', ignored), false);
  assertEquals(isIgnoredPrice('price_unknown', new Set()), false);
});
