-- Backoffice kan "stoppa" en order: den blir grå (ingen beställning) men tas inte bort.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status = any (array['pending'::text, 'done'::text, 'stopped'::text]));
