alter table order_items
  add column if not exists vendor_override text,
  add column if not exists notify_excluded boolean not null default false;
