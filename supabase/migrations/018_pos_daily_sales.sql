-- Daily sales per POS shop/kassa, populated by the dinkassa sync (derived from the
-- Z-reports). Lets the widget/reports show Chao without a live dinkassa connection.
create table if not exists pos_daily_sales (
  qopla_shop_id text not null,
  business_date date not null,
  shop_name text,
  source text not null default 'dinkassa',
  sales numeric not null default 0,
  orders integer,
  updated_at timestamptz default now(),
  primary key (qopla_shop_id, business_date)
);
alter table pos_daily_sales enable row level security;
create policy "allow_all" on pos_daily_sales for all using (true) with check (true);
