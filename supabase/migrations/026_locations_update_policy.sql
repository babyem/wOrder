-- Allow logged-in admins to reorder the orders-board columns (sort_order updates)
create policy "locations_update_authenticated" on locations
  for update to authenticated using (true) with check (true);
