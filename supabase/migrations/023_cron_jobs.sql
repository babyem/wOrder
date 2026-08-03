-- Schedule daily pending reminder + weekly report via pg_cron/pg_net
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Daily 15:00 UTC (17:00 svensk sommartid): push reminder if pending orders exist
select cron.schedule(
  'pending-reminder-daily',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'https://cjrzeoswkzenwlftsahp.supabase.co/functions/v1/pending-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcnplb3N3a3plbndsZnRzYWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjkwMTIsImV4cCI6MjA5NDM0NTAxMn0.KHMSRNjvuzlCny3ciDJj2CtJTOeXKLk3u3HAijlLAEg'
    ),
    body := '{}'::jsonb
  );
  $$
);
