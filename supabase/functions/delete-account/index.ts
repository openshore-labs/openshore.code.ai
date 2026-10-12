// Delete the signed-in person's account (Apple 5.1.1(v); next build E1; tech review 11
// package C, one design). The app's Settings, Your account, Delete account
// posts here with the caller's access token and an empty body; nothing in the
// body is read.
//
// Auth: a CALLER-SCOPED anon client resolves
// auth.getUser() as the caller, and every read and write after that goes
// through a SEPARATE service-role client, for that one user id only.
// verify_jwt = true in config.toml gates the endpoint too.
//
// Order matters, so every read happens first and _shared/accountDeletion.ts
// plans the rest. The database writes are 0022 section 6's service-role
// functions, each safe to run twice, so a failure partway is finished by
// trying again.
//   1. Read: any Personal entitlement and Apple link left from before
//      OpenShore went free (2026-10-11), and the orgs this
//      account owns (with their member rows and billing).
//   2. Refuse with owns_org (409) when an owned org has anyone else active:
//      the team is not this person's alone to erase. Nothing has changed.
//   3. Cancel every Stripe subscription that could still charge, for the
//      person and for each org about to go. Apple bills on its own; the
//      answer carries appleNote so the app can say where to cancel it.
//   4. Delete the owned orgs, only if nobody else is active in any of them
//      and this account still owns every one, in one statement
//      (account_deletion_orgs). Fewer back than planned means someone joined,
//      or support handed a team over, after step 1: answer owns_org. Nothing
//      was deleted then, but step 3 has already canceled that team's
//      subscription; the window is the time between step 1 and step 4.
//   5. Copy the rows under a legal hold into deletion_holds, before anything
//      under a hold is deleted (account_deletion_hold; 0019's table, 18
//      U.S.C. 2258A(h)). It comes after step 4 so an owns_org answer leaves
//      no copy behind for an account that stays, and deleting a team touches
//      no guardrail or enforcement row.
//   6. Keep a tombstone when an operator confirmed a termination of this
//      account, so deleting it does not reset the ladder
//      (account_deletion_tombstone; never for an automatic termination).
//   7. Clear the person from team history (org_vault_revisions.updated_by,
//      the one update 0022 allows), then remove their memberships and project
//      grants by id and, where nobody has claimed them, by confirmed email
//      (account_deletion_memberships).
//   8. auth.admin.deleteUser. Everything keyed to the user cascades or, for
//      authored team rows, is set null (0019, 0022).
//
// Answers: 200 { ok: true, deleted: true, appleNote } (`ok` for main's app,
// `deleted` for a build that read the 2026-09-24 function), or
// { error: code } with a code from DELETE_ACCOUNT_ERRORS. Nothing from the
// request or the database is echoed.
//
// Not here, and live in the 2026-09-24 function until this one is deployed:
// the ten-minute re-sign-in check, deleting a team that still has members,
// and refunds (decisions F2 and F3; they return with the privacy
// branch's own PR).
//
// Env (Supabase function secrets): SUPABASE_URL, SUPABASE_ANON_KEY
// (auto-injected), SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY (only read
// when there is a Stripe customer or subscription to cancel).
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  DELETE_ACCOUNT_STATUS,
  deletedAnswer,
  otherActiveMembers,
  ownedOrgsGone,
  planAccountDeletion,
  subscriptionMayBill,
  subscriptionsToCancel,
  type BillingRow,
  type DeleteAccountError,
  type MemberRow,
  type OwnedOrg,
} from '../_shared/accountDeletion.ts';

class BillingError extends Error {}

function refuse(code: DeleteAccountError, req: Request): Response {
  return json({ error: code }, DELETE_ACCOUNT_STATUS[code], req);
}

// Cancel every subscription that could still charge: each customer's live
// ones, then any recorded id no listing covered. Stripe's word on a
// subscription's status wins over our row's.
async function cancelStripe(customers: string[], subscriptions: string[]): Promise<void> {
  if (customers.length === 0 && subscriptions.length === 0) return;
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new BillingError('STRIPE_SECRET_KEY is not set');
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  const seen = new Set<string>();
  const cancel = new Set<string>();
  try {
    for (const customer of customers) {
      const subs = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 });
      for (const s of subs.data) seen.add(s.id);
      for (const id of subscriptionsToCancel(subs.data)) cancel.add(id);
    }
    for (const id of subscriptions) {
      if (seen.has(id)) continue;
      const sub = await stripe.subscriptions.retrieve(id);
      if (subscriptionMayBill(sub.status)) cancel.add(id);
    }
    for (const id of cancel) await stripe.subscriptions.cancel(id);
  } catch (err) {
    throw new BillingError(err instanceof Error ? err.message : 'stripe failed');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return refuse('failed', req);
  try {
    // Caller-scoped client: auth.uid() = the signed-in user.
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await asUser.auth.getUser();
    if (!user) return refuse('unauthorized', req);
    const uid = user.id;

    // Service-role client for everything after (bypasses RLS on purpose),
    // always filtered to this one user id.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ---- 1. read
    const { data: personal, error: personalErr } = await admin
      .from('user_entitlements')
      .select('source, status, stripe_customer_id, stripe_subscription_id')
      .eq('user_id', uid)
      .maybeSingle();
    if (personalErr) throw new Error(`user_entitlements read failed: ${personalErr.message}`);

    const { count: appleLinks, error: appleErr } = await admin
      .from('apple_links')
      .select('original_transaction_id', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (appleErr) throw new Error(`apple_links read failed: ${appleErr.message}`);

    const { data: orgs, error: orgsErr } = await admin
      .from('orgs')
      .select('id, stripe_customer_id')
      .eq('owner_uid', uid);
    if (orgsErr) throw new Error(`orgs read failed: ${orgsErr.message}`);

    const ownedOrgs: OwnedOrg[] = [];
    for (const org of orgs ?? []) {
      const { data: members, error: membersErr } = await admin
        .from('org_members')
        .select('user_id, status')
        .eq('org_id', org.id)
        .eq('status', 'active');
      if (membersErr) throw new Error(`org_members read failed: ${membersErr.message}`);
      const { data: ent, error: entErr } = await admin
        .from('org_entitlements')
        .select('status, stripe_subscription_id')
        .eq('org_id', org.id)
        .maybeSingle();
      if (entErr) throw new Error(`org_entitlements read failed: ${entErr.message}`);
      const billing: BillingRow = {
        status: ent?.status ?? null,
        stripe_customer_id: org.stripe_customer_id ?? null,
        stripe_subscription_id: ent?.stripe_subscription_id ?? null,
      };
      ownedOrgs.push({
        id: org.id,
        otherActiveMembers: otherActiveMembers((members ?? []) as MemberRow[], uid),
        billing,
      });
    }

    // ---- 2. plan, and refuse before any write
    const plan = planAccountDeletion({
      personal: personal ?? null,
      appleLinked: (appleLinks ?? 0) > 0,
      ownedOrgs,
    });
    if (plan.refuse) return refuse(plan.refuse, req);

    // ---- 3. billing
    await cancelStripe(plan.stripeCustomers, plan.stripeSubscriptions);

    // ---- 4. owned orgs, all or none, only while nobody else is active
    if (plan.deleteOrgs.length > 0) {
      const { data: gone, error: delOrgErr } = await admin.rpc('account_deletion_orgs', {
        p_owner: uid,
        p_orgs: plan.deleteOrgs,
      });
      if (delOrgErr) throw new Error(`orgs delete failed: ${delOrgErr.message}`);
      if (!ownedOrgsGone(plan.deleteOrgs, gone)) return refuse('owns_org', req);
    }

    // ---- 5. the legal-hold copy, before anything under a hold is deleted
    const { error: holdErr } = await admin.rpc('account_deletion_hold', { p_user: uid });
    if (holdErr) throw new Error(`legal-hold copy failed: ${holdErr.message}`);

    // ---- 6. tombstone, while the enforcement record still exists
    const { error: tombErr } = await admin.rpc('account_deletion_tombstone', { p_user: uid });
    if (tombErr) throw new Error(`tombstone write failed: ${tombErr.message}`);

    // ---- 7. team history, then memberships and grants by id and email
    const { error: revErr } = await admin
      .from('org_vault_revisions')
      .update({ updated_by: null })
      .eq('updated_by', uid);
    if (revErr) throw new Error(`org_vault_revisions update failed: ${revErr.message}`);
    const { error: memErr } = await admin.rpc('account_deletion_memberships', { p_user: uid });
    if (memErr) throw new Error(`memberships delete failed: ${memErr.message}`);

    // ---- 8. the account
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) throw new Error(`deleteUser failed: ${delErr.message}`);

    return json(deletedAnswer(plan.appleNote), 200, req);
  } catch (err) {
    if (err instanceof BillingError) {
      console.error('delete-account billing error', err.message);
      return refuse('billing', req);
    }
    console.error('delete-account error', err);
    return refuse('failed', req);
  }
});
