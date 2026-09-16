-- Spara själva meddelandet så loggen i sidomenyn kan visa vad som skickades.
alter table order_send_log add column if not exists subject text;
alter table order_send_log add column if not exists body text;
