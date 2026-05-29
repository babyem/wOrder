-- Fortnox auto-booking: map Qopla shops to Fortnox companies and post daily SIE
-- sales as vouchers (verifikat series "F"). See api/fortnox-sync.js.

-- Fortnox companies (bolag). Non-secret — client-readable for the mapping dropdown.
create table if not exists fortnox_companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,                 -- display label, e.g. "Bolag AB"
  org_no text,                        -- optional Fortnox org number (info only)
  created_at timestamptz default now()
);
alter table fortnox_companies enable row level security;
create policy "allow_all" on fortnox_companies for all using (true) with check (true);

-- OAuth2 tokens per company. SECRET — readable by service role only.
-- RLS enabled with NO policy => the anon/auth keys are denied entirely.
create table if not exists fortnox_tokens (
  company_id uuid primary key references fortnox_companies(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  updated_at timestamptz default now()
);
alter table fortnox_tokens enable row level security;  -- intentionally no policy

-- Qopla shop -> Fortnox company mapping (non-secret).
create table if not exists fortnox_shop_map (
  qopla_shop_id text primary key,
  qopla_shop_name text,
  company_id uuid references fortnox_companies(id) on delete set null,
  cost_center text,                   -- optional override; else use SIE costCenter
  enabled boolean default true
);
alter table fortnox_shop_map enable row level security;
create policy "allow_all" on fortnox_shop_map for all using (true) with check (true);

-- Posting log + idempotency guard (non-secret) for the status table.
create table if not exists fortnox_postings (
  id uuid primary key default uuid_generate_v4(),
  qopla_shop_id text not null,
  business_date date not null,
  reference_report_id text,
  company_id uuid,
  voucher_series text,
  voucher_number text,
  status text not null,               -- 'ok' | 'error' | 'skipped'
  message text,
  created_at timestamptz default now(),
  unique (qopla_shop_id, business_date)
);
alter table fortnox_postings enable row level security;
create policy "allow_all" on fortnox_postings for all using (true) with check (true);
