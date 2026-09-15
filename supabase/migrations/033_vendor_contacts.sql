-- Flera kontaktvägar per leverantör, med valfritt smeknamn ("Kontoret", "Anna").
-- Form: [{ "id": "...", "type": "email" | "phone", "value": "...", "label": "..." }]
-- Kolumnerna email/phone finns kvar och speglar första kontakten av varje typ —
-- api/telegram.js läser dem fortfarande. Appen håller dem i synk vid varje ändring.
alter table vendors add column if not exists contacts jsonb not null default '[]'::jsonb;

update vendors set contacts =
  case when email is not null and email <> ''
    then jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'type', 'email', 'value', email))
    else '[]'::jsonb end
  ||
  case when phone is not null and phone <> ''
    then jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'type', 'phone', 'value', phone))
    else '[]'::jsonb end
where contacts = '[]'::jsonb;
