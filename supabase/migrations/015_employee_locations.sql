-- Junction table: one employee can belong to many locations
create table if not exists employee_locations (
  employee_id uuid not null references employees(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  primary key (employee_id, location_id)
);

-- Migrate existing single-location assignments
insert into employee_locations (employee_id, location_id)
select id, location_id from employees
where location_id is not null
on conflict do nothing;

-- location_id on employees is now redundant; make it nullable
alter table employees alter column location_id drop not null;

-- RLS (same permissive approach as other metadata tables)
alter table employee_locations enable row level security;
create policy "allow_all" on employee_locations for all using (true) with check (true);
