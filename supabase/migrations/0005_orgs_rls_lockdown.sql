-- Lock down orgs writes (P0-3). Before this, orgs_update had a USING clause but
-- no WITH CHECK, and authenticated held table-wide UPDATE, so any admin could
-- PATCH any column of their org: self-grant tier_id (top tier for free) or
-- re-point stripe_customer_id at another customer. Entitlement is decided by the
-- webhook-written org_entitlements.status, and orgs.tier_id is display only, so
-- a client must never be able to write it.
--
-- Two layers, both required:
--   1. RLS WITH CHECK so a row still belongs to an admin/owner after an update.
--   2. Column-level UPDATE privileges: authenticated may update only the three
--      columns a person legitimately edits. tier_id, stripe_customer_id, and
--      owner_uid become non-updatable by clients; the service role (webhook,
--      checkout) bypasses column grants and still writes them.
--
-- Deploy ordering: apply this BEFORE or WITH the app change that PATCHes
-- seat_count (store.ts setSeatCount). seat_count stays granted, so that write
-- keeps working; tier_id / stripe_customer_id writes from a client now fail,
-- which is the point.

drop policy if exists orgs_update on public.orgs;
create policy orgs_update on public.orgs for update
  using (public.is_org_admin(id) or owner_uid = auth.uid())
  with check (public.is_org_admin(id) or owner_uid = auth.uid());

-- Strip table-wide UPDATE, then grant back only the client-editable columns.
revoke update on public.orgs from authenticated, anon;
grant update (name, seat_count, price_year) on public.orgs to authenticated;

-- INSERT vector (follow-up surfaced during remediation). The UPDATE lockdown
-- above still left INSERT table-wide, so a client could create a self-owned org
-- with a forged stripe_customer_id pointing at a victim's Stripe customer; the
-- double-checkout guard would then hand that client the victim's billing-portal
-- URL. Close it the same way: strip table-wide INSERT and grant back only the
-- columns org creation legitimately sets (pushOrgToServer writes exactly these,
-- never stripe_customer_id). The service role still inserts freely. tier_id on
-- insert stays harmless because access gates on org_entitlements, not orgs.
revoke insert on public.orgs from authenticated, anon;
grant insert (name, owner_uid, seat_count, tier_id, price_year) on public.orgs to authenticated;
