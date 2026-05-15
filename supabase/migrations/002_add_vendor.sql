-- Add vendor column to products
alter table products add column if not exists vendor text not null default 'General';

-- Seed vendors on existing products
update products set vendor = 'Beverages Co.' where category = 'Beverages';
update products set vendor = 'Dry Goods Inc.' where category = 'Dry Goods';
update products set vendor = 'Office Supplies Ltd.' where category = 'Supplies';
update products set vendor = 'Clean World' where category = 'Cleaning';
