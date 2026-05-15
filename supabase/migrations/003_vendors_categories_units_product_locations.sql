-- Managed metadata tables
create table if not exists vendors (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz default now()
);

create table if not exists categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz default now()
);

create table if not exists units (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz default now()
);

-- Product visibility per location (empty = visible everywhere)
create table if not exists product_locations (
  product_id uuid references products(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  primary key (product_id, location_id)
);

-- RLS
alter table vendors enable row level security;
alter table categories enable row level security;
alter table units enable row level security;
alter table product_locations enable row level security;

create policy "Public read vendors" on vendors for select using (true);
create policy "Authenticated write vendors" on vendors for all using (auth.role() = 'authenticated');

create policy "Public read categories" on categories for select using (true);
create policy "Authenticated write categories" on categories for all using (auth.role() = 'authenticated');

create policy "Public read units" on units for select using (true);
create policy "Authenticated write units" on units for all using (auth.role() = 'authenticated');

create policy "Public read product_locations" on product_locations for select using (true);
create policy "Authenticated write product_locations" on product_locations for all using (auth.role() = 'authenticated');

-- Seed from existing product data
insert into vendors (name)
  select distinct vendor from products where vendor is not null and vendor != ''
  on conflict do nothing;

insert into categories (name)
  select distinct category from products where category is not null and category != ''
  on conflict do nothing;

insert into units (name)
  select distinct unit from products where unit is not null and unit != ''
  on conflict do nothing;
