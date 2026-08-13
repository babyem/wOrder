-- Global column order for the orders board
alter table locations add column if not exists sort_order integer not null default 0;

-- Seed existing rows alphabetically so the initial order matches the old default
with ranked as (
  select id, row_number() over (order by name) - 1 as rn
  from locations
)
update locations l
set sort_order = ranked.rn
from ranked
where l.id = ranked.id;
