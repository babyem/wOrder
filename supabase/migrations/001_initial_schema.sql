-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Locations
create table if not exists locations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz default now()
);

-- Employees
create table if not exists employees (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  location_id uuid references locations(id) on delete cascade,
  active boolean default true,
  created_at timestamptz default now()
);

-- Products
create table if not exists products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  image_url text,
  category text not null default 'General',
  unit text not null default 'st',
  active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- Orders
create table if not exists orders (
  id uuid primary key default uuid_generate_v4(),
  location_id uuid references locations(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done')),
  note text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Order items
create table if not exists order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  quantity integer not null check (quantity > 0)
);

-- Storage bucket for product images
insert into storage.buckets (id, name, public) values ('products', 'products', true)
on conflict do nothing;

-- Storage policy: anyone can read product images
create policy "Public read product images" on storage.objects
  for select using (bucket_id = 'products');

-- Storage policy: authenticated users can upload product images
create policy "Authenticated upload product images" on storage.objects
  for insert with check (bucket_id = 'products' and auth.role() = 'authenticated');

create policy "Authenticated delete product images" on storage.objects
  for delete using (bucket_id = 'products' and auth.role() = 'authenticated');

-- RLS: enable on all tables
alter table locations enable row level security;
alter table employees enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

-- Locations: public read, authenticated write
create policy "Public read locations" on locations for select using (true);
create policy "Authenticated write locations" on locations for all using (auth.role() = 'authenticated');

-- Employees: public read, authenticated write
create policy "Public read employees" on employees for select using (true);
create policy "Authenticated write employees" on employees for all using (auth.role() = 'authenticated');

-- Products: public read active, authenticated all
create policy "Public read products" on products for select using (true);
create policy "Authenticated write products" on products for all using (auth.role() = 'authenticated');

-- Orders: anyone can insert, authenticated can read/update/delete
create policy "Anyone can insert orders" on orders for insert with check (true);
create policy "Authenticated read orders" on orders for select using (auth.role() = 'authenticated');
create policy "Authenticated update orders" on orders for update using (auth.role() = 'authenticated');
create policy "Authenticated delete orders" on orders for delete using (auth.role() = 'authenticated');

-- Order items: anyone insert, authenticated read/delete
create policy "Anyone can insert order_items" on order_items for insert with check (true);
create policy "Authenticated read order_items" on order_items for select using (auth.role() = 'authenticated');
create policy "Authenticated delete order_items" on order_items for delete using (auth.role() = 'authenticated');

-- Seed sample data
insert into locations (name) values
  ('Downtown'),
  ('Uptown'),
  ('Airport')
on conflict do nothing;

insert into employees (name, location_id, active)
select 'Anna Karlsson', id, true from locations where name = 'Downtown'
on conflict do nothing;

insert into employees (name, location_id, active)
select 'Erik Lindqvist', id, true from locations where name = 'Downtown'
on conflict do nothing;

insert into employees (name, location_id, active)
select 'Sofia Berg', id, true from locations where name = 'Uptown'
on conflict do nothing;

insert into employees (name, location_id, active)
select 'Marcus Johansson', id, true from locations where name = 'Airport'
on conflict do nothing;

insert into products (name, category, unit, sort_order) values
  ('Coffee Beans', 'Beverages', 'kg', 1),
  ('Milk', 'Beverages', 'L', 2),
  ('Sugar', 'Dry Goods', 'kg', 3),
  ('Napkins', 'Supplies', 'pack', 4),
  ('Cups (Large)', 'Supplies', 'pack', 5),
  ('Cups (Small)', 'Supplies', 'pack', 6),
  ('Straws', 'Supplies', 'pack', 7),
  ('Cleaning Spray', 'Cleaning', 'bottle', 8),
  ('Paper Towels', 'Cleaning', 'roll', 9),
  ('Gloves', 'Cleaning', 'box', 10)
on conflict do nothing;
