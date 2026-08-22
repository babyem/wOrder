-- Soft delete for orders so a removal can be undone
alter table orders add column if not exists deleted_at timestamptz;

-- Board/list queries always filter on deleted_at is null
create index if not exists orders_deleted_at_idx on orders (deleted_at) where deleted_at is null;
