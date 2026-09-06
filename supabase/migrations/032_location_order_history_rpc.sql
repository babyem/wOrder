-- Personalsidan är anonym och får inte läsa orders direkt. Den här funktionen
-- returnerar butikens orderhistorik i platt form (en rad per orderrad) så att
-- appen kan räkna fram "vanlig beställning" och rimlighetskoll lokalt.
-- Hoppar över borttagna/stoppade ordrar, "ingen beställning"-besked och rader
-- som backoffice exkluderat (de var fel och ska inte läras in).
create or replace function public.location_order_history(p_location_id uuid, p_days int default 90)
returns table (
  order_id uuid,
  created_at timestamptz,
  product_id uuid,
  quantity numeric,
  unit text,
  vendor text
)
language sql
security definer
set search_path = public
stable
as $$
  select o.id, o.created_at, oi.product_id, oi.quantity::numeric,
         coalesce(oi.unit_override, p.unit),
         coalesce(oi.vendor_override, p.vendor)
  from orders o
  join order_items oi on oi.order_id = o.id
  left join products p on p.id = oi.product_id
  where o.location_id = p_location_id
    and o.deleted_at is null
    and o.no_order_vendor is null
    and o.status <> 'stopped'
    and not oi.notify_excluded
    and o.created_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
  order by o.created_at desc;
$$;

revoke all on function public.location_order_history(uuid, int) from public;
grant execute on function public.location_order_history(uuid, int) to anon, authenticated;
