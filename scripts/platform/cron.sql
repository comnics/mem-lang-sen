-- Supabase scheduled job for M6 push notification dispatch.
-- Replace the Vault secret names and deployment URL in the dashboard or a
-- privileged migration context; do not store real secrets in this file.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule('mem-lang-sen-push-dispatch')
where exists (
  select 1
  from cron.job
  where jobname = 'mem-lang-sen-push-dispatch'
);

select cron.schedule(
  'mem-lang-sen-push-dispatch',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'MEM_LANG_SEN_APP_ORIGIN') || '/api/jobs/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'MEM_LANG_SEN_JOB_TRIGGER_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
