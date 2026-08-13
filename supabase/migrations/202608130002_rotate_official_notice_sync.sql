do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in ('sync-official-notices-every-20-minutes', 'sync-official-notices-rotating')
  loop
    perform cron.unschedule(existing_job);
  end loop;
end $$;

select cron.schedule(
  'sync-official-notices-rotating',
  '*/3 * * * *',
  $$
  select net.http_post(
    url := 'https://iqweoywmawveeehvbbky.supabase.co/functions/v1/sync-notices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2VveXdtYXd2ZWVlaHZiYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MzgzODgsImV4cCI6MjEwMTIxNDM4OH0.k22v3MiyjzWT3ED1Q-G_X0SLvMiRCv-JSoeecAo_7gA',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2VveXdtYXd2ZWVlaHZiYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MzgzODgsImV4cCI6MjEwMTIxNDM4OH0.k22v3MiyjzWT3ED1Q-G_X0SLvMiRCv-JSoeecAo_7gA'
    ),
    body := jsonb_build_object('trigger', 'supabase-cron'),
    timeout_milliseconds := 25000
  ) as request_id;
  $$
);
