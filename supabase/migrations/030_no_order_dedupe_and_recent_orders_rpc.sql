-- Ett "ingen beställning"-besked per butik, leverantör och dag (Stockholm-tid)
create unique index if not exists orders_no_order_once_per_day
  on orders (location_id, no_order_vendor, ((created_at at time zone 'Europe/Stockholm')::date))
  where no_order_vendor is not null and deleted_at is null;

-- Personalsidan är anonym och får inte läsa orders direkt. Den här funktionen
-- returnerar bara de senaste ordrarna för en given butik, i samma form som
-- OrderWithDetails i appen.
create or replace function public.location_recent_orders(p_location_id uuid, p_limit int default 10)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  from (
    select o.*,
      to_jsonb(l) as location,
      to_jsonb(e) as employee,
      coalesce((
        select jsonb_agg(to_jsonb(oi) || jsonb_build_object('product', to_jsonb(p)) order by oi.id)
        from order_items oi
        left join products p on p.id = oi.product_id
        where oi.order_id = o.id
      ), '[]'::jsonb) as items
    from orders o
    left join locations l on l.id = o.location_id
    left join employees e on e.id = o.employee_id
    where o.location_id = p_location_id
      and o.deleted_at is null
    order by o.created_at desc
    limit least(greatest(p_limit, 1), 20)
  ) r;
$$;

revoke all on function public.location_recent_orders(uuid, int) from public;
grant execute on function public.location_recent_orders(uuid, int) to anon, authenticated;
