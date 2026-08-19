-- Provision-by-email claim. An admin adds a teammate by email (an invited row
-- with user_id null). When that person signs in, the app calls this once and
-- their auth.uid() is bound to the invited seat. The caller is resolved from
-- their JWT (auth.uid / auth.email), never from client-supplied input, so no one
-- can claim a seat that was not invited for their verified email.
create or replace function public.claim_membership()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed int;
begin
  update public.org_members m
    set user_id = auth.uid(), status = 'active'
    where lower(m.email) = lower(auth.email())
      and m.user_id is null
      and m.status = 'invited';
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

grant execute on function public.claim_membership() to authenticated;
