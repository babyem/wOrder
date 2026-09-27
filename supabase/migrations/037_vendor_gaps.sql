-- "Saknas idag": leverantörer en butik brukar beställa från den här veckodagen men
-- som varken har en order eller ett "ingen beställning"-besked idag.
-- Mönstret lärs från de senaste 6 veckorna; minst 3 av 6 samma veckodagar krävs.

create table if not exists order_gap_dismissals (
  location_id uuid not null references locations(id) on delete cascade,
  vendor text not null,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (location_id, vendor, day)
);

alter table order_gap_dismissals enable row level security;

create policy "Authenticated all order_gap_dismissals" on order_gap_dismissals
  for all to authenticated using (true) with check (true);

create or replace function public.vendor_gaps_today()
returns table (
  location_id uuid,
  vendor text,
  days_hit int,
  days_total int,
  usual_time text,
  last_order date
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select (now() at time zone 'Europe/Stockholm')::date as today
  ),
  -- En rad per butik/leverantör/dag, med första ordertiden den dagen.
  activity as (
    select o.location_id,
           coalesce(oi.vendor_override, p.vendor) as vendor,
           (o.created_at at time zone 'Europe/Stockholm')::date as day,
           min((o.created_at at time zone 'Europe/Stockholm')::time) as first_time
    from orders o
    join order_items oi on oi.order_id = o.id
    left join products p on p.id = oi.product_id
    where o.deleted_at is null
      and o.created_at > now() - interval '44 days'
    group by 1, 2, 3
    union all
    select o.location_id, o.no_order_vendor,
           (o.created_at at time zone 'Europe/Stockholm')::date, null::time
    from orders o
    where o.deleted_at is null
      and o.no_order_vendor is not null
      and o.created_at > now() - interval '44 days'
  ),
  hist as (
    select a.*
    from activity a, params p
    where a.vendor is not null
      and a.day < p.today
      and a.day >= p.today - 42
      and extract(dow from a.day) = extract(dow from p.today)
  ),
  expected as (
    select location_id, vendor,
           count(distinct day)::int as days_hit,
           6 as days_total,
           to_char(percentile_cont(0.5) within group (order by first_time::interval), 'HH24:MI') as usual_time
    from hist
    group by 1, 2
    having count(distinct day) >= 3
  )
  select e.location_id, e.vendor, e.days_hit, e.days_total, e.usual_time,
         (select max(a.day) from activity a
           where a.location_id = e.location_id and a.vendor = e.vendor and a.day < p.today) as last_order
  from expected e, params p
  where not exists (
          select 1 from activity a
          where a.location_id = e.location_id and a.vendor = e.vendor and a.day = p.today)
    and not exists (
          select 1 from order_gap_dismissals d
          where d.location_id = e.location_id and d.vendor = e.vendor and d.day = p.today)
  order by e.location_id, e.usual_time nulls last, e.vendor;
$$;

revoke all on function public.vendor_gaps_today() from public;
grant execute on function public.vendor_gaps_today() to authenticated;
