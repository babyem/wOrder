alter table products
  add column if not exists tingstad_id text,
  add column if not exists tingstad_unit text;

alter table products
  add column if not exists tingstad_unit_qty numeric default 1;
