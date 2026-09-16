-- Logga även misslyckade mailutskick så loggen visar grön bock / rött kryss.
alter table order_send_log
  add column if not exists status text not null default 'sent' check (status in ('sent', 'failed')),
  add column if not exists error text;
