-- "Ingen beställning" — personalen kan meddela att butiken inte beställer från en
-- leverantör idag. Raden är en vanlig order utan order_items; kolumnen anger vilken
-- leverantör meddelandet gäller (t.ex. 'Kho').
alter table orders add column if not exists no_order_vendor text;
