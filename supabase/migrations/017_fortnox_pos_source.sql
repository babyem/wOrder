-- Multi-POS support for Fortnox booking. A mapping row's qopla_shop_id holds either a
-- Qopla shopId (source='qopla') or a dinkassa machineId (source='dinkassa').
alter table fortnox_shop_map add column if not exists source text not null default 'qopla';
