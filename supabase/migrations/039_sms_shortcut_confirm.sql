-- SMS via Genvägar (iPhone/Mac): appen skriver en 'pending'-rad och startar
-- genvägen "wOrder SMS", som skickar SMS:et och sedan anropar /api/sms-sent.
-- Endpointen kör confirm_sms_sent() som flippar raden till 'sent'.
alter table order_send_log drop constraint if exists order_send_log_status_check;
alter table order_send_log
  add constraint order_send_log_status_check check (status in ('pending', 'sent', 'failed'));

-- Inloggade får bara röra rader som fortfarande väntar: bekräfta manuellt
-- ("Klar") eller ta bort när genvägen avbröts.
create policy "Authenticated settle pending order_send_log" on order_send_log
  for update to authenticated using (status = 'pending') with check (status in ('sent', 'failed'));
create policy "Authenticated delete pending order_send_log" on order_send_log
  for delete to authenticated using (status = 'pending');

-- Anropas av /api/sms-sent med anon-nyckeln. Rad-id:t (uuid, skapat i appen)
-- fungerar som engångsnyckel: bara en väntande SMS-rad yngre än 30 min kan
-- bekräftas, och bara en gång.
create or replace function confirm_sms_sent(p_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with u as (
    update order_send_log
       set status = 'sent', sent_at = now()
     where id = p_id
       and channel = 'sms'
       and status = 'pending'
       and sent_at > now() - interval '30 minutes'
    returning 1
  )
  select exists (select 1 from u);
$$;

revoke all on function confirm_sms_sent(uuid) from public;
grant execute on function confirm_sms_sent(uuid) to anon, authenticated;
