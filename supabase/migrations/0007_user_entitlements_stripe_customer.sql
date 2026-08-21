-- Add stripe_customer_id to user_entitlements (individual Personal rail).
--
-- This column belongs to the individual Stripe checkout: the customer id
-- persists on the buyer's row so repeat checkouts reuse one Stripe customer and
-- the portal can find it. It is a SEPARATE migration on purpose: 0006 was
-- already committed before this column existed, and `supabase db push` will not
-- re-run an applied migration, so amending 0006 in place would silently skip the
-- column on any database where 0006 had already landed. An idempotent ALTER
-- guarantees the column exists whether or not 0006 predates it.
--
-- Deploy ordering: apply BEFORE deploying the individual stripe-checkout /
-- stripe-webhook / stripe-portal, which read and write this column; without it
-- every individual code path 500s on a missing column.

alter table public.user_entitlements
  add column if not exists stripe_customer_id text;

-- One Stripe customer maps to at most one individual. A partial unique index
-- (NULLs allowed, so Apple-only rows with no Stripe customer coexist) keeps the
-- webhook's userIdForCustomer lookup a safe single-row read.
create unique index if not exists user_entitlements_stripe_customer_idx
  on public.user_entitlements (stripe_customer_id)
  where stripe_customer_id is not null;
