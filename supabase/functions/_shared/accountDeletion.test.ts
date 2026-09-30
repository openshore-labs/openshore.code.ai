// Deno tests for delete-account's decisions. Run:
// `deno test supabase/functions/_shared/accountDeletion.test.ts`. The edge
// function has no runtime harness; these cover the plan it follows, how it
// reads the owned-team delete's answer, and the answer it sends. The database
// writes it asks for (0022 section 6) are covered by
// supabase/tests/account_deletion.test.sql.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  DELETE_ACCOUNT_ERRORS,
  DELETE_ACCOUNT_STATUS,
  deletedAnswer,
  otherActiveMembers,
  ownedOrgsGone,
  planAccountDeletion,
  subscriptionMayBill,
  subscriptionsToCancel,
  type DeletionFacts,
} from './accountDeletion.ts';

const nobody: DeletionFacts = {
  personal: null,
  appleLinked: false,
  ownedOrgs: [],
};

Deno.test('plan: an account with nothing attached just goes', () => {
  assertEquals(planAccountDeletion(nobody), {
    stripeCustomers: [],
    stripeSubscriptions: [],
    deleteOrgs: [],
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
        billing: {
          status: 'active',
          stripe_customer_id: 'cus_org',
          stripe_subscription_id: 'sub_org',
        },
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

Deno.test(
  'plan: an Apple subscription gets the note, and its old Stripe customer is still swept',
  () => {
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
  },
);

Deno.test(
  'members: only an active row bound to someone else counts, as in account_deletion_orgs',
  () => {
    const owner = 'owner';
    assertEquals(
      otherActiveMembers(
        [
          { user_id: owner, status: 'active' },
          { user_id: null, status: 'invited' },
          { user_id: null, status: 'active' },
          { user_id: 'gone', status: 'revoked' },
        ],
        owner,
      ),
      0,
    );
    assertEquals(
      otherActiveMembers(
        [
          { user_id: owner, status: 'active' },
          { user_id: 'teammate', status: 'active' },
        ],
        owner,
      ),
      1,
    );
  },
);

Deno.test('owned-team delete: every planned team back is done; fewer is owns_org', () => {
  assertEquals(ownedOrgsGone([], null), true);
  assertEquals(ownedOrgsGone(['a', 'b'], ['b', 'a']), true);
  assertEquals(ownedOrgsGone(['a', 'b'], ['a']), false);
  // All or none: a teammate turned active, so nothing came back.
  assertEquals(ownedOrgsGone(['a'], []), false);
  // Not a list of ids: read as nothing deleted, never as done.
  assertEquals(ownedOrgsGone(['a'], null), false);
  assertEquals(ownedOrgsGone(['a'], 'a'), false);
  assertEquals(ownedOrgsGone(['a'], [{ id: 'a' }]), false);
});

Deno.test('answer: both client contracts read success', () => {
  assertEquals(deletedAnswer(true), { ok: true, deleted: true, appleNote: true });
  assertEquals(deletedAnswer(false), { ok: true, deleted: true, appleNote: false });
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
