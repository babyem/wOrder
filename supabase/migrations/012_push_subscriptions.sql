create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

alter table push_subscriptions enable row level security;

create policy "anon_can_insert" on push_subscriptions
  for insert to anon with check (true);

create policy "anon_can_delete_own" on push_subscriptions
  for delete to anon using (true);

create policy "service_role_can_select" on push_subscriptions
  for select to service_role using (true);
