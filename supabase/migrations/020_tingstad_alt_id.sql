-- Alternative Tingstad article number: used as a fallback when the primary
-- tingstad_id is out of stock / not orderable.
alter table products
  add column if not exists tingstad_alt_id text;
