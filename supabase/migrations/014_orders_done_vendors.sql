-- Add done_vendors column to orders for global per-vendor done tracking
alter table orders
  add column if not exists done_vendors text[] default array[]::text[];
