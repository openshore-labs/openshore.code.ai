// Delete the signed-in person's account (Apple 5.1.1(v); next build E1). The
// app's Settings, Your account, Delete account posts here with the caller's
// access token and an empty body; nothing in the body is read.
//
// Auth (mirrors link-apple-purchase): a CALLER-SCOPED anon client resolves
// auth.getUser() as the caller, and every read and write after that goes
// through a SEPARATE service-role client, for that one user id only.
// verify_jwt = true in config.toml gates the endpoint too.
//
// Order matters, so every read happens first and _shared/accountDeletion.ts
// plans the rest; a refusal never follows a write.
//   1. Read: the Personal entitlement and Apple link, the orgs this account
//      owns (with who else is active in each and their billing), and the
//      enforcement record.
//   2. Refuse with owns_org (409) when an owned org has anyone else active:
//      the team is not this person's alone to erase.
//   3. Cancel every Stripe subscription that could still charge, for the
//      person and for each org about to go. Apple bills on its own; the
//      answer carries appleNote so the app can say where to cancel it.
//   4. Keep a tombstone (a hash of the email and the ladder level) when the
//      account was ever warned or terminated, so deleting it does not reset
//      the ladder (0022).
//   5. Delete the owned orgs (their notes, projects, and entitlement cascade),
//      clear the person from team history (org_vault_revisions.updated_by,
//      the one update 0022 allows), and remove their memberships.
//   6. auth.admin.deleteUser. Everything keyed to the user cascades or, for
//      authored team rows, is set null (0022).
// Each step is safe to run twice, so a failure partway is finished by trying
// again.
//
// Answers: 200 { ok: true, appleNote }, or { error: code } with a code from
// DELETE_ACCOUNT_ERRORS. Nothing from the request or the database is echoed.
//
// Env (Supabase function secrets): SUPABASE_URL, SUPABASE_ANON_KEY
// (auto-injected), SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY (only read
// when there is a Stripe customer or subscription to cancel).
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  DELETE_ACCOUNT_STATUS,
  emailSha256,
  mergeTombstoneLevel,
  planAccountDeletion,
  subscriptionMayBill,
  subscriptionsToCancel,
  type BillingRow,
  type DeleteAccountError,
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
      const { count: others, error: othersErr } = await admin
        .from('org_members')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .eq('status', 'active')
        .neq('user_id', uid);
      if (othersErr) throw new Error(`org_members read failed: ${othersErr.message}`);
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
      ownedOrgs.push({ id: org.id, otherActiveMembers: others ?? 0, billing });
    }

    const { data: actions, error: actionsErr } = await admin
      .from('enforcement_actions')
      .select('action')
      .eq('user_id', uid)
      .in('action', ['warn', 'terminate']);
    if (actionsErr) throw new Error(`enforcement_actions read failed: ${actionsErr.message}`);

    const { count: reports, error: reportsErr } = await admin
      .from('abuse_reports')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (reportsErr) throw new Error(`abuse_reports read failed: ${reportsErr.message}`);

    // ---- 2. plan, and refuse before any write
    const plan = planAccountDeletion({
      personal: personal ?? null,
      appleLinked: (appleLinks ?? 0) > 0,
      ownedOrgs,
      enforcementActions: (actions ?? []).map((a) => String(a.action)),
      hasAbuseReport: (reports ?? 0) > 0,
    });
    if (plan.refuse) return refuse(plan.refuse, req);

    // ---- 3. billing
    await cancelStripe(plan.stripeCustomers, plan.stripeSubscriptions);

    // ---- 4. tombstone, while the enforcement record still exists
    if (plan.tombstoneLevel > 0 && user.email) {
      const key = await emailSha256(user.email);
      const { data: prior, error: priorErr } = await admin
        .from('enforcement_tombstones')
        .select('level')
        .eq('email_sha256', key)
        .maybeSingle();
      if (priorErr) throw new Error(`tombstone read failed: ${priorErr.message}`);
      const { error: tombErr } = await admin.from('enforcement_tombstones').upsert(
        {
          email_sha256: key,
          level: mergeTombstoneLevel(prior?.level, plan.tombstoneLevel),
          recorded_at: new Date().toISOString(),
        },
        { onConflict: 'email_sha256' },
      );
      if (tombErr) throw new Error(`tombstone write failed: ${tombErr.message}`);
    }

    // ---- 5. orgs, team history, memberships
    if (plan.deleteOrgs.length > 0) {
      const { error: delOrgErr } = await admin
        .from('orgs')
        .delete()
        .in('id', plan.deleteOrgs)
        .eq('owner_uid', uid);
      if (delOrgErr) throw new Error(`orgs delete failed: ${delOrgErr.message}`);
    }
    const { error: revErr } = await admin
      .from('org_vault_revisions')
      .update({ updated_by: null })
      .eq('updated_by', uid);
    if (revErr) throw new Error(`org_vault_revisions update failed: ${revErr.message}`);
    const { error: memErr } = await admin.from('org_members').delete().eq('user_id', uid);
    if (memErr) throw new Error(`org_members delete failed: ${memErr.message}`);

    // ---- 6. the account
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) throw new Error(`deleteUser failed: ${delErr.message}`);

    return json({ ok: true, appleNote: plan.appleNote }, 200, req);
  } catch (err) {
    if (err instanceof BillingError) {
      console.error('delete-account billing error', err.message);
      return refuse('billing', req);
    }
    console.error('delete-account error', err);
    return refuse('failed', req);
  }
});
