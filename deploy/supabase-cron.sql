-- Supabase Cron → the app's background jobs (docs/02 §7).
--
-- Run once in the Supabase SQL editor, after the first deployment, when the app on Vercel has
-- SCHEDULER_MODE=external and CRON_SECRET set. Needs the pg_cron and pg_net extensions
-- (Database → Extensions) and Vault (on by default). Replace the two placeholder values: they are
-- stored encrypted in Vault, never in the cron job definition.
--
-- This is not a Drizzle migration: pg_cron, pg_net and Vault exist only on Supabase, not in the
-- local PGlite database or in tests.

-- 1. Secrets. To change one later: select vault.update_secret(id, 'new value') using the id from vault.secrets.
select vault.create_secret('https://YOUR-APP.vercel.app', 'gentouch_app_url', 'Base URL of the GenTouch app');
select vault.create_secret('PASTE-THE-CRON_SECRET-FROM-VERCEL', 'gentouch_cron_secret', 'Bearer token for /api/cron/tick');

-- 2. Every minute, ask the app to run whatever background jobs are due. Each job is idempotent and
--    lease-protected, so a slow, repeated or missed tick is harmless.
select cron.schedule(
  'gentouch-background-jobs',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'gentouch_app_url') || '/api/cron/tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gentouch_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Is it running?
--   select jobid, jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
--   select status_code, created from net._http_response order by created desc limit 10;
-- The app's own view: Settings → System health lists each job's last run.
--
-- Stop it:
--   select cron.unschedule('gentouch-background-jobs');
