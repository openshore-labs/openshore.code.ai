// Delete the signed-in person's OpenShore account (compliance pass two, part A;
// DECISIONS.md 2026-09-24, "Account deletion ships with Download my data").
//
// The order is deliberate. Every check that can refuse runs before anything
// changes, and billing (the one step that cannot be undone from here) runs
// before any row is deleted, so a Stripe failure leaves the account whole:
//
//   1. The caller's JWT resolves the user. The sign-in behind it must be under
//      10 minutes old, or this answers 401 {code: "reauth_required"} and the
//      app asks the person to sign in again.
//   2. Orgs the person owns: one with other active members stops the deletion
//      with 409 {code: "transfer_or_delete_org", orgs: [...]} unless the body
//      names it in {deleteOrgs: [ids]}. A sole-member org goes with the
//      account.
//   3. Billing. Each org being deleted has its Stripe subscription cancelled
//      now, and its latest paid invoice refunded in full when paid within 14
//      days. A personal Stripe subscription is set to cancel at period end.
//      Apple subscriptions cannot be cancelled from a server; the app tells the
//      person where to do it.
//   4. Owned orgs are deleted (their members, entitlements, vault, and shared
//      projects cascade). The person's own memberships and project grants are
//      deleted by user id and by confirmed email.
//   5. Guardrail rows under a legal hold are copied into deletion_holds under a
//      SHA-256 of the user id, without the id itself.
//   6. auth.admin.deleteUser. Everything keyed to the user cascades (reviews,
//      push devices and grants, entitlements, blocks, guardrail history).
//
// A retry after a partial failure is safe: every step is idempotent, and a
// refund carries an idempotency key per invoice.
//
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected),
// SUPABASE_SERVICE_ROLE_KEY.
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { isEntitled } from '../_shared/entitlement.ts';
import {
  bearerToken,
  decodeJwtPayload,
  escapeLike,
  isRecentSignIn,
  latestHold,
  orgsNeedingChoice,
  parseDeleteOrgs,
  refundEligible,
  sameEmail,
  stripUserId,
  type OwnedOrg,
} from '../_shared/accountDeletion.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' });

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stripeCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

/** Cancel an org's subscription now and refund its latest paid invoice when it
 *  is inside the refund window. A subscription Stripe no longer knows, or one
 *  already cancelled, is not an error; an invoice already refunded is not
 *  refunded twice. */
async function cancelOrgSubscription(subscriptionId: string): Promise<{ refunded: boolean }> {
  let status: string | undefined;
  try {
    status = (await stripe.subscriptions.retrieve(subscriptionId)).status;
  } catch (err) {
    if (stripeCode(err) === 'resource_missing') return { refunded: false };
    throw err;
  }
  if (status !== 'canceled') await stripe.subscriptions.cancel(subscriptionId);

  const invoices = await stripe.invoices.list({
    subscription: subscriptionId,
    status: 'paid',
    limit: 1,
  });
  const invoice = invoices.data[0];
  if (!invoice) return { refunded: false };
  const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
  if (!refundEligible(paidAt, invoice.amount_paid, Date.now())) return { refunded: false };

  const paymentIntent =
    typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id;
  const charge = typeof invoice.charge === 'string' ? invoice.charge : invoice.charge?.id;
  if (!paymentIntent && !charge) return { refunded: false };
  try {
    await stripe.refunds.create(paymentIntent ? { payment_intent: paymentIntent } : { charge }, {
      idempotencyKey: `delete-account-refund-${invoice.id}`,
    });
  } catch (err) {
    if (stripeCode(err) === 'charge_already_refunded') return { refunded: true };
    throw err;
  }
  return { refunded: true };
}

/** Set a personal subscription to end at its period end. Already cancelled or
 *  unknown to Stripe is fine. */
async function cancelPersonalAtPeriodEnd(subscriptionId: string): Promise<void> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (sub.status === 'canceled' || sub.cancel_at_period_end) return;
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  } catch (err) {
    if (stripeCode(err) === 'resource_missing') return;
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405, req);
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Sign in first.', code: 'not_signed_in' }, 401, req);

    // 1. A recent sign-in. The token is already verified by getUser above, so
    // reading its claims here is safe.
    const claims = decodeJwtPayload(bearerToken(authHeader) ?? '');
    if (!isRecentSignIn(claims, Date.now())) {
      return json(
        {
          error: 'For your safety, sign in again, then delete your account.',
          code: 'reauth_required',
        },
        401,
        req,
      );
    }

    const body = await req.json().catch(() => ({}));
    const deleteOrgs = parseDeleteOrgs(body);
    const uid = user.id;
    const confirmedEmail = user.email && user.email_confirmed_at ? user.email : undefined;

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 2. Owned orgs, and who else is in them.
    const { data: ownedRows, error: ownedErr } = await admin
      .from('orgs')
      .select('id,name')
      .eq('owner_uid', uid);
    if (ownedErr) throw new Error(`orgs read failed: ${ownedErr.message}`);

    const owned: Array<OwnedOrg & { subscriptionId?: string }> = [];
    for (const org of ownedRows ?? []) {
      const { data: members, error: membersErr } = await admin
        .from('org_members')
        .select('user_id,email')
        .eq('org_id', org.id)
        .eq('status', 'active');
      if (membersErr) throw new Error(`org_members read failed: ${membersErr.message}`);
      const others = (members ?? []).filter(
        (m) => m.user_id !== uid && !sameEmail(m.email, user.email),
      ).length;
      const { data: ent, error: entErr } = await admin
        .from('org_entitlements')
        .select('status,valid_until,stripe_subscription_id')
        .eq('org_id', org.id)
        .maybeSingle();
      if (entErr) throw new Error(`org_entitlements read failed: ${entErr.message}`);
      owned.push({
        id: org.id,
        name: org.name,
        otherActiveMembers: others,
        paid:
          !!ent?.stripe_subscription_id &&
          isEntitled({ status: ent.status, validUntil: ent.valid_until }),
        subscriptionId: ent?.stripe_subscription_id ?? undefined,
      });
    }

    const needChoice = orgsNeedingChoice(owned, deleteOrgs);
    if (needChoice.length > 0) {
      return json(
        {
          error: 'You own a team with other people in it. Choose what happens to it first.',
          code: 'transfer_or_delete_org',
          orgs: needChoice.map((o) => ({
            id: o.id,
            name: o.name,
            members: o.otherActiveMembers,
            paid: o.paid,
          })),
        },
        409,
        req,
      );
    }

    // 3. Billing, before any row is deleted.
    for (const org of owned) {
      if (!org.subscriptionId) continue;
      try {
        await cancelOrgSubscription(org.subscriptionId);
      } catch (err) {
        console.error('delete-account: org billing cancel failed', org.id, err);
        return json(
          {
            error: `Could not cancel billing for ${org.name}. Nothing was deleted. Try again.`,
            code: 'billing_failed',
          },
          502,
          req,
        );
      }
    }
    const { data: personal, error: personalErr } = await admin
      .from('user_entitlements')
      .select('source,stripe_subscription_id')
      .eq('user_id', uid)
      .maybeSingle();
    if (personalErr) throw new Error(`user_entitlements read failed: ${personalErr.message}`);
    if (personal?.source === 'stripe' && personal.stripe_subscription_id) {
      try {
        await cancelPersonalAtPeriodEnd(personal.stripe_subscription_id);
      } catch (err) {
        console.error('delete-account: personal cancel failed', err);
        return json(
          {
            error: 'Could not stop your subscription from renewing. Nothing was deleted. Try again.',
            code: 'billing_failed',
          },
          502,
          req,
        );
      }
    }

    // 4. Owned orgs, then the person's own memberships and grants.
    if (owned.length > 0) {
      const { error } = await admin
        .from('orgs')
        .delete()
        .in(
          'id',
          owned.map((o) => o.id),
        );
      if (error) throw new Error(`orgs delete failed: ${error.message}`);
    }
    for (const table of ['org_members', 'org_project_members'] as const) {
      const byId = await admin.from(table).delete().eq('user_id', uid);
      if (byId.error) throw new Error(`${table} delete failed: ${byId.error.message}`);
      if (confirmedEmail) {
        const { data: rows, error: readErr } = await admin
          .from(table)
          .select('id,email')
          .ilike('email', escapeLike(confirmedEmail));
        if (readErr) throw new Error(`${table} read failed: ${readErr.message}`);
        const ids = (rows ?? []).filter((r) => sameEmail(r.email, confirmedEmail)).map((r) => r.id);
        if (ids.length > 0) {
          const byEmail = await admin.from(table).delete().in('id', ids);
          if (byEmail.error) throw new Error(`${table} delete failed: ${byEmail.error.message}`);
        }
      }
    }

    // 5. Rows under legal hold outlive the account, under a hash of its id.
    const nowIso = new Date().toISOString();
    const { data: heldEvents, error: heldEventsErr } = await admin
      .from('guardrail_events')
      .select('*')
      .eq('user_id', uid)
      .gt('legal_hold_until', nowIso);
    if (heldEventsErr) throw new Error(`guardrail_events read failed: ${heldEventsErr.message}`);
    const { data: heldActions, error: heldActionsErr } = await admin
      .from('enforcement_actions')
      .select('*')
      .eq('user_id', uid)
      .gt('legal_hold_until', nowIso);
    if (heldActionsErr) {
      throw new Error(`enforcement_actions read failed: ${heldActionsErr.message}`);
    }
    const events = heldEvents ?? [];
    const actions = heldActions ?? [];
    if (events.length > 0 || actions.length > 0) {
      const holdUntil = latestHold([...events, ...actions]);
      const { error } = await admin.from('deletion_holds').insert({
        user_id_sha256: await sha256Hex(uid),
        held_rows: {
          guardrail_events: stripUserId(events),
          enforcement_actions: stripUserId(actions),
        },
        hold_until: holdUntil,
      });
      if (error) throw new Error(`deletion_holds insert failed: ${error.message}`);
    }

    // 6. The account itself.
    const { error: deleteErr } = await admin.auth.admin.deleteUser(uid);
    if (deleteErr) throw new Error(`deleteUser failed: ${deleteErr.message}`);

    return json({ deleted: true }, 200, req);
  } catch (err) {
    console.error('delete-account error', err);
    return json({ error: 'Could not delete the account. Try again.' }, 500, req);
  }
});
