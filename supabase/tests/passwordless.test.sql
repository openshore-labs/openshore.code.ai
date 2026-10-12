-- pgTAP coverage for passwordless sign-in (0028). Run with `supabase test db`
-- against a database that has every migration applied. Its own transaction
-- and its own plan().
--
-- 1. No password is ever stored: an insert or an update that carries one
--    leaves auth.users.encrypted_password empty, so GoTrue's password grant
--    refuses every account (HasPassword is false).
-- 2. A passkey is added only after a fresh email sign-in: the step-up trigger
--    on GoTrue's auth.webauthn_credentials refuses an insert unless the
--    account proved its inbox (otp, magiclink or email/signup) on a live
--    session in the last 10 minutes.
-- 3. Neither function is callable by a client.
--
-- Users are seeded straight into auth.users in their own id range
-- (7f000000-...), and the whole run is rolled back.

begin;
select plan(11);

-- ------------------------------------------------------------ 1. no password
insert into auth.users (id, email, encrypted_password, aud, role, created_at)
values ('7f000000-0000-0000-0000-000000000001', 'pw-insert@test.invalid',
        '$2a$10$abcdefghijklmnopqrstuuOe0mK2c1hY0W6y3xg1KkJmP0C0YbQ0e', 'authenticated', 'authenticated', now());

select is(
  (select encrypted_password from auth.users where id = '7f000000-0000-0000-0000-000000000001'),
  '',
  'an insert that carries a password hash stores none'
);

update auth.users set encrypted_password = '$2a$10$another.hash.that.must.never.land.here.000000000000'
 where id = '7f000000-0000-0000-0000-000000000001';

select is(
  (select encrypted_password from auth.users where id = '7f000000-0000-0000-0000-000000000001'),
  '',
  'an update that sets a password stores none'
);

update auth.users set email = 'pw-insert-2@test.invalid'
 where id = '7f000000-0000-0000-0000-000000000001';

select is(
  (select email from auth.users where id = '7f000000-0000-0000-0000-000000000001'),
  'pw-insert-2@test.invalid',
  'other writes to the row go through untouched'
);

select is(
  (select count(*)::int from auth.users where coalesce(encrypted_password, '') <> ''),
  0,
  'no account in the database has a password'
);

-- ------------------------------------------------------------ 2. step-up
--   p1 signed in by email code 2 minutes ago, on a live session
--   p2 signed in by email code 20 minutes ago
--   p3 signed in by passkey a minute ago (a passkey cannot add a passkey)
--   p4 signed in by email code 2 minutes ago, on a session that has ended
insert into auth.users (id, email, aud, role, created_at)
values
  ('7f000000-0000-0000-0000-000000000011', 'p1@test.invalid', 'authenticated', 'authenticated', now()),
  ('7f000000-0000-0000-0000-000000000012', 'p2@test.invalid', 'authenticated', 'authenticated', now()),
  ('7f000000-0000-0000-0000-000000000013', 'p3@test.invalid', 'authenticated', 'authenticated', now()),
  ('7f000000-0000-0000-0000-000000000014', 'p4@test.invalid', 'authenticated', 'authenticated', now());

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('7f000000-0000-0000-0000-0000000000a1', '7f000000-0000-0000-0000-000000000011', now(), now(), null),
  ('7f000000-0000-0000-0000-0000000000a2', '7f000000-0000-0000-0000-000000000012', now(), now(), null),
  ('7f000000-0000-0000-0000-0000000000a3', '7f000000-0000-0000-0000-000000000013', now(), now(), null),
  ('7f000000-0000-0000-0000-0000000000a4', '7f000000-0000-0000-0000-000000000014', now(), now(), now() - interval '1 minute');

insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
values
  (gen_random_uuid(), '7f000000-0000-0000-0000-0000000000a1', now() - interval '2 minutes',  now() - interval '2 minutes',  'otp'),
  (gen_random_uuid(), '7f000000-0000-0000-0000-0000000000a2', now() - interval '20 minutes', now() - interval '20 minutes', 'otp'),
  (gen_random_uuid(), '7f000000-0000-0000-0000-0000000000a3', now() - interval '1 minute',   now() - interval '1 minute',   'passkey'),
  (gen_random_uuid(), '7f000000-0000-0000-0000-0000000000a4', now() - interval '2 minutes',  now() - interval '2 minutes',  'otp');

create temp table passkey_row (uid uuid, n int);
insert into passkey_row values
  ('7f000000-0000-0000-0000-000000000011', 1),
  ('7f000000-0000-0000-0000-000000000012', 2),
  ('7f000000-0000-0000-0000-000000000013', 3),
  ('7f000000-0000-0000-0000-000000000014', 4);

create or replace function pg_temp.add_passkey(p_n int) returns void language sql as $$
  insert into auth.webauthn_credentials (user_id, credential_id, public_key)
  select uid, convert_to('cred-' || n, 'UTF8'), convert_to('key-' || n, 'UTF8')
    from passkey_row where n = p_n;
$$;

select ok(
  exists (select 1 from pg_trigger
           where tgname = 'oscode_passkey_step_up'
             and tgrelid = 'auth.webauthn_credentials'::regclass),
  'the step-up trigger is on GoTrue''s passkeys table'
);

select lives_ok(
  $$ select pg_temp.add_passkey(1) $$,
  'an email sign-in 2 minutes ago on a live session may add a passkey'
);

select throws_ok(
  $$ select pg_temp.add_passkey(2) $$,
  'P0001', 'passkey_needs_recent_email',
  'an email sign-in 20 minutes ago may not'
);

select throws_ok(
  $$ select pg_temp.add_passkey(3) $$,
  'P0001', 'passkey_needs_recent_email',
  'a passkey sign-in may not add another passkey'
);

select throws_ok(
  $$ select pg_temp.add_passkey(4) $$,
  'P0001', 'passkey_needs_recent_email',
  'a fresh email sign-in on a session that has ended may not'
);

-- ------------------------------------------------------------ 3. not callable
select ok(
  not has_function_privilege('authenticated', 'public.oscode_no_password()', 'execute')
  and not has_function_privilege('anon', 'public.oscode_no_password()', 'execute'),
  'oscode_no_password is not callable by a client'
);

select ok(
  not has_function_privilege('authenticated', 'public.oscode_passkey_step_up()', 'execute')
  and not has_function_privilege('anon', 'public.oscode_passkey_step_up()', 'execute'),
  'oscode_passkey_step_up is not callable by a client'
);

select * from finish();
rollback;
