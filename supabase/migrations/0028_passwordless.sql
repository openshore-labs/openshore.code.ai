-- 0028: passwordless sign-in (founder 2026-10-12; CTO ruling 2026-10-12, Q1
-- and Q3, recorded in os-code/DECISIONS.md). OpenShore signs people in by an
-- email code or link, and by a passkey once they add one. No password is kept
-- anywhere: the Proton standard keeps the bare minimum.
--
-- UNAPPLIED. It lands on main for the founder's push through
-- docs/vault-gate1-runbook.md, after supabase/scripts/push-preflight.mjs and a
-- preflight on a branch project; that push appends its history row.
--
-- Every statement is safe to run again.

-- 1. Clear every stored password hash. Hosted Supabase cannot turn off the
--    password grant on its own (the whole email provider would go with it,
--    and the email code with it), but GoTrue refuses the grant for an account
--    whose encrypted_password is empty. Existing sessions are left alone, so
--    nobody signed in today is signed out by this.
update auth.users
   set encrypted_password = ''
 where coalesce(encrypted_password, '') <> '';

-- 2. Keep it empty for good. /signup with a password and PUT /user with a
--    password stay open on the server, so a trigger empties the column on
--    every write instead. It never raises, so no GoTrue flow turns into a 500;
--    a password sent there is simply never stored.
create or replace function public.oscode_no_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.encrypted_password := '';
  return new;
end;
$$;

revoke all on function public.oscode_no_password() from public, anon, authenticated;

drop trigger if exists oscode_no_password on auth.users;
create trigger oscode_no_password
  before insert or update of encrypted_password on auth.users
  for each row execute function public.oscode_no_password();

-- 3. A passkey is added only by someone who proved the inbox again in the
--    last 10 minutes (a sign-in by email code or link on a live session).
--    GoTrue's registration accepts any signed-in session, so without this a
--    stolen session could plant a passkey of its own and outlive a sign-out
--    everywhere. The app checks the same before it asks (lib/passkeys.ts);
--    this is the line that holds.
create or replace function public.oscode_passkey_step_up()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from auth.mfa_amr_claims c
      join auth.sessions s on s.id = c.session_id
     where s.user_id = new.user_id
       and c.authentication_method in ('otp', 'magiclink', 'email/signup')
       and c.updated_at > now() - interval '10 minutes'
       and (s.not_after is null or s.not_after > now())
  ) then
    raise exception 'passkey_needs_recent_email'
      using errcode = 'P0001',
            hint = 'Sign in by email again, then add the passkey.';
  end if;
  return new;
end;
$$;

revoke all on function public.oscode_passkey_step_up() from public, anon, authenticated;

-- The passkeys table is GoTrue's own (auth.webauthn_credentials, its
-- migration 20260302000000). A database whose auth server predates it (the
-- local CLI image) has no such table, and a platform that refuses triggers
-- on it leaves it bare; either way the push goes on, says so, and passkeys
-- stay off: the runbook checks this trigger exists before they are turned on
-- (CTO, 2026-10-12).
do $$
begin
  if to_regclass('auth.webauthn_credentials') is null then
    raise notice '0028: auth.webauthn_credentials is not here yet; passkeys stay off until the step-up trigger is on it';
    return;
  end if;
  begin
    execute 'drop trigger if exists oscode_passkey_step_up on auth.webauthn_credentials';
    execute 'create trigger oscode_passkey_step_up
               before insert on auth.webauthn_credentials
               for each row execute function public.oscode_passkey_step_up()';
  exception when insufficient_privilege then
    raise notice '0028: no trigger allowed on auth.webauthn_credentials; passkeys stay off';
  end;
end $$;
