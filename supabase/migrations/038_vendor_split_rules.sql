-- Delningsregler per leverantör: varor i en butiks order som ska listas under en annan
-- mottagare i samma meddelande. Läses av src/lib/vendorSplit.js (appen + api/telegram.js).
-- Form: [{ "location": "Woso Triangeln", "label": "Letsgrab",
--          "items": [{ "product_id": "...", "share": 1 | 0.5 }] }]
alter table vendors add column if not exists split_rules jsonb not null default '[]'::jsonb;

-- Easy Asia: av Woso Triangelns order hör handskalade räkor, jordnötter, glasnudlar
-- och halva edamamen (utan skal) till Letsgrab.
update vendors set split_rules = jsonb_build_array(jsonb_build_object(
  'location', 'Woso Triangeln',
  'label', 'Letsgrab',
  'items', (
    select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'share', s.share) order by s.ord), '[]'::jsonb)
    from (values ('Tom Salat', 1, 1), ('Do xanh', 0.5, 2), ('Lac', 1, 3), ('Glasnudlar', 1, 4)) as s(name, share, ord)
    join products p on p.vendor = 'Easy Asia' and p.name = s.name
  )
))
where name = 'Easy Asia' and split_rules = '[]'::jsonb;
