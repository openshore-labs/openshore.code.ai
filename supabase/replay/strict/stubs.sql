-- The pieces of a Supabase database the migrations lean on, for the strict
-- rebuild (supabase/scripts/replay-strict.sh, CI job `sql-strict`): the three
-- Data API roles, the corners of GoTrue's auth schema the files and the
-- pgTAP suite touch, Vault's view of its secrets, and the extensions schema.
--
-- What it leaves out on purpose: Supabase's default privileges. Before
-- 2026-10-30 a project granted anon, authenticated and service_role every
-- privilege on each new table in public; after it, a rebuilt database grants
-- nothing. Here nothing is granted by default, on tables, sequences or
-- functions, so a migration that leaned on the defaults fails the suite
-- instead of production's next rebuild.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists vault;
create schema if not exists extensions;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap;

-- GoTrue's tables, only the columns the migrations and the tests use.
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  encrypted_password text,
  aud text,
  role text,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create table auth.sessions (
  id uuid primary key,
  user_id uuid,
  ip inet,
  user_agent text,
  aal text,
  not_after timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
create table auth.mfa_amr_claims (
  id uuid primary key,
  session_id uuid,
  authentication_method text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table auth.audit_log_entries (id uuid primary key, created_at timestamptz);
create table auth.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  credential_id bytea,
  public_key bytea,
  attestation_type text,
  aaguid uuid,
  sign_count bigint,
  transports jsonb,
  backup_eligible boolean,
  backed_up boolean,
  friendly_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_used_at timestamptz
);

-- auth.uid() and auth.email() read the claims PostgREST sets, as on Supabase.
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.email() returns text language sql stable as
  $$ select auth.jwt() ->> 'email' $$;
create function auth.role() returns text language sql stable as
  $$ select auth.jwt() ->> 'role' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Vault: the one secret 0019 needs, under its name, with a throwaway value.
create table vault.secrets (name text primary key, secret text not null);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text, new_description text default null)
returns uuid language sql as
  $$ insert into vault.secrets values (new_name, new_secret); select gen_random_uuid() $$;
insert into vault.secrets values ('guardrail_hmac_key', encode(extensions.gen_random_bytes(32), 'hex'));

do $$
begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;
