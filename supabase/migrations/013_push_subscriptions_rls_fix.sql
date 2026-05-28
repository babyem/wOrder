-- Fix RLS so authenticated users (signed-in staff) can also subscribe.
-- Original policies in 012_push_subscriptions.sql granted access to `anon` only,
-- which broke .upsert() once the user logged in (role becomes `authenticated`).
-- Also adds an UPDATE policy required by .upsert(onConflict: 'endpoint').

drop policy if exists "anon_can_insert"        on push_subscriptions;
drop policy if exists "anon_can_delete_own"    on push_subscriptions;
drop policy if exists "service_role_can_select" on push_subscriptions;

-- public = both anon and authenticated
create policy "public_can_insert" on push_subscriptions
  for insert to public with check (true);

create policy "public_can_update" on push_subscriptions
  for update to public using (true) with check (true);

create policy "public_can_delete" on push_subscriptions
  for delete to public using (true);

-- service_role bypasses RLS by default, but keep an explicit select policy
-- in case the edge function ever runs with a different key.
create policy "service_role_can_select" on push_subscriptions
  for select to service_role using (true);
