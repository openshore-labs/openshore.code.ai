-- OS Code accounts: orgs, members, and entitlements. This mirrors the app's
-- local Org / OrgMember model (app/src/state/types.ts) so the server can enforce
-- what the app only checks as UX today. Personal accounts need no rows here; a
-- commercial org is one row in `orgs` plus a row per person in `org_members`.
create extension if not exists pgcrypto;

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_uid uuid not null references auth.users (id) on delete restrict,
  seat_count int not null default 1,
  tier_id text not null default 'personal',
  price_year int not null default 0,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  -- Null until the invited person signs in and claims the seat.
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
-- One membership per email per org (case-insensitive).
create unique index if not exists org_members_org_email_idx
  on public.org_members (org_id, lower(email));
create index if not exists org_members_user_idx on public.org_members (user_id);

create table if not exists public.org_entitlements (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  tier_id text not null,
  seats int not null,
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled', 'trialing')),
  valid_until timestamptz,
  stripe_subscription_id text,
  issued_at timestamptz not null default now()
);
