-- Logg över utskick till leverantörer från backoffice (mail via send-email,
-- SMS bekräftat av användaren). Visas i sidomenyn under omsättnings-widgeten.
create table if not exists order_send_log (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  vendor_name text not null,
  location_names text[] not null default '{}',
  channel text not null check (channel in ('email', 'sms')),
  contact_value text not null,
  contact_label text,
  order_ids uuid[] not null default '{}'
);

create index if not exists order_send_log_sent_at_idx on order_send_log (sent_at desc);

alter table order_send_log enable row level security;

create policy "Authenticated read order_send_log" on order_send_log
  for select to authenticated using (true);
create policy "Authenticated insert order_send_log" on order_send_log
  for insert to authenticated with check (true);
