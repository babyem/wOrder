-- Genvägen "wOrder SMS" anropar nu RPC:n direkt (Hobby-planen tillåter max 12
-- Vercel-funktioner, så /api/sms-sent togs bort). Genvägen POST:ar { "id": ... },
-- så den här varianten tar parametern `id`. confirm_sms_sent(p_id) från 039
-- används inte längre men får ligga kvar.
create or replace function sms_confirm(id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with u as (
    update order_send_log l
       set status = 'sent', sent_at = now()
     where l.id = sms_confirm.id
       and l.channel = 'sms'
       and l.status = 'pending'
       and l.sent_at > now() - interval '30 minutes'
    returning 1
  )
  select exists (select 1 from u);
$$;

revoke all on function sms_confirm(uuid) from public;
grant execute on function sms_confirm(uuid) to anon, authenticated;
