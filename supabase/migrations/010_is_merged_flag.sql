alter table orders
  add column if not exists is_merged boolean not null default false;
