-- En notis-väg för nya ordrar: Vercel-routen /api/new-order (trigger new-order-telegram)
-- skickar Telegram, web push och ntfy. Edge-funktionen notify-order och dess trigger tas bort.
drop trigger if exists "notify-order" on public.orders;
