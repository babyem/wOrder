alter table products
  add column if not exists chefsculinar_id text,
  add column if not exists chefsculinar_unit text;

alter table products
  add column if not exists chefsculinar_unit_qty numeric default 1;
