// Deno tests for delete-account's decisions. Run:
// `deno test supabase/functions/_shared/accountDeletion.test.ts`. The edge
// function has no runtime harness; these cover the plan it follows and the
// email hash the tombstone is keyed by (the same hex tests/
// account_deletion.test.sql pins for 0022's enforcement_email_key).
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  DELETE_ACCOUNT_ERRORS,
  DELETE_ACCOUNT_STATUS,
  emailSha256,
  mergeTombstoneLevel,
  normalizeEmail,
  planAccountDeletion,
  subscriptionMayBill,
  subscriptionsToCancel,
  tombstoneLevelFor,
  type DeletionFacts,
} from './accountDeletion.ts';

const nobody: DeletionFacts = {
  personal: null,
  appleLinked: false,
  ownedOrgs: [],
  enforcementActions: [],
  hasAbuseReport: false,
};

Deno.test('plan: an account with nothing attached just goes', () => {
  assertEquals(planAccountDeletion(nobody), {
    stripeCustomers: [],
    stripeSubscriptions: [],
    deleteOrgs: [],
    tombstoneLevel: 0,
    appleNote: false,
  });
});

Deno.test('plan: an owned org with anyone else active refuses, before any write', () => {
  const plan = planAccountDeletion({
    ...nobody,
    personal: { source: 'stripe', status: 'active', stripe_customer_id: 'cus_me' },
    ownedOrgs: [
      { id: 'solo', otherActiveMembers: 0, billing: null },
      { id: 'team', otherActiveMembers: 2, billing: null },
    ],
  });
  assertEquals(plan, { refuse: 'owns_org' });
});

Deno.test('plan: a sole-member org is deleted and its billing swept', () => {
  const plan = planAccountDeletion({
    ...nobody,
    ownedOrgs: [
      {
        id: 'solo',
        otherActiveMembers: 0,
        billing: { status: 'active', stripe_customer_id: 'cus_org', stripe_subscription_id: 'sub_org' },
      },
    ],
  });
  if (plan.refuse) throw new Error('should not refuse');
  assertEquals(plan.deleteOrgs, ['solo']);
  assertEquals(plan.stripeCustomers, ['cus_org']);
  assertEquals(plan.stripeSubscriptions, ['sub_org']);
});

Deno.test('plan: a live Personal subscription on Stripe is canceled; a dead one is not', () => {
  const live = planAccountDeletion({
    ...nobody,
    personal: {
      source: 'stripe',
      status: 'past_due',
      stripe_customer_id: 'cus_me',
      stripe_subscription_id: 'sub_me',
    },
  });
  if (live.refuse) throw new Error('should not refuse');
  assertEquals(live.stripeCustomers, ['cus_me']);
  assertEquals(live.stripeSubscriptions, ['sub_me']);
  assertEquals(live.appleNote, false);

  const dead = planAccountDeletion({
    ...nobody,
    personal: { source: 'stripe', status: 'canceled', stripe_subscription_id: 'sub_old' },
  });
  if (dead.refuse) throw new Error('should not refuse');
  assertEquals(dead.stripeSubscriptions, []);
});

Deno.test('plan: an Apple subscription gets the note, and its old Stripe customer is still swept', () => {
  const plan = planAccountDeletion({
    ...nobody,
    personal: { source: 'apple', status: 'active', stripe_customer_id: 'cus_earlier' },
  });
  if (plan.refuse) throw new Error('should not refuse');
  assertEquals(plan.appleNote, true);
  assertEquals(plan.stripeCustomers, ['cus_earlier']);

  const linkedOnly = planAccountDeletion({ ...nobody, appleLinked: true });
  if (linkedOnly.refuse) throw new Error('should not refuse');
  assertEquals(linkedOnly.appleNote, true);
});

Deno.test('plan: the tombstone follows the ladder', () => {
  const level = (facts: Partial<DeletionFacts>) => {
    const plan = planAccountDeletion({ ...nobody, ...facts });
    if (plan.refuse) throw new Error('should not refuse');
    return plan.tombstoneLevel;
  };
  assertEquals(level({ enforcementActions: ['log-only'] }), 0);
  assertEquals(level({ enforcementActions: ['log-only', 'warn'] }), 1);
  assertEquals(level({ enforcementActions: ['warn', 'terminate'] }), 2);
  assertEquals(level({ hasAbuseReport: true }), 2);
});

Deno.test('tombstoneLevelFor and mergeTombstoneLevel never step down', () => {
  assertEquals(tombstoneLevelFor([], false), 0);
  assertEquals(mergeTombstoneLevel(2, 1), 2);
  assertEquals(mergeTombstoneLevel(1, 2), 2);
  assertEquals(mergeTombstoneLevel(null, 1), 1);
  assertEquals(mergeTombstoneLevel(7, 0), 0);
});

Deno.test('subscriptions: only canceled and incomplete_expired are finished', () => {
  for (const s of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']) {
    assertEquals(subscriptionMayBill(s), true, s);
  }
  for (const s of ['canceled', 'incomplete_expired', '', null, undefined]) {
    assertEquals(subscriptionMayBill(s), false, String(s));
  }
  assertEquals(
    subscriptionsToCancel([
      { id: 'a', status: 'active' },
      { id: 'b', status: 'canceled' },
      { id: 'c', status: 'incomplete' },
    ]),
    ['a', 'c'],
  );
});

Deno.test('errors: a fixed set of codes, each with its status', () => {
  assertEquals([...DELETE_ACCOUNT_ERRORS], ['unauthorized', 'owns_org', 'billing', 'failed']);
  assertEquals(DELETE_ACCOUNT_STATUS.owns_org, 409);
  assertEquals(DELETE_ACCOUNT_STATUS.unauthorized, 401);
});

Deno.test('email hash: ASCII case folded, SHA-256 hex, the same as the SQL key', async () => {
  assertEquals(
    await emailSha256('returner@example.com'),
    '83bac1dc27f294e2dddc84ed4adf8e854e28261f626cf27a129eecf62a0fc361',
  );
  assertEquals(await emailSha256('Returner@Example.COM'), await emailSha256('returner@example.com'));
  // Only ASCII letters fold, as `lower(... collate "C")` does in 0022.
  assertEquals(normalizeEmail('ÉLAN@Example.com'), 'Élan@example.com');
});
