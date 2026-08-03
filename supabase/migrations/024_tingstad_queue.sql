create table if not exists tingstad_queue (
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  location_name text,
  products jsonb not null,
  status text not null default 'pending', -- pending | processing | done | failed
  error text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

alter table tingstad_queue enable row level security;

create policy "anon_full_access" on tingstad_queue
  for all to anon using (true) with check (true);
