create table if not exists public.official_notice_feed (
  id text primary key check (id = 'current'),
  feed jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.official_notice_feed enable row level security;

revoke all on table public.official_notice_feed from anon, authenticated;
grant select on table public.official_notice_feed to anon, authenticated;

drop policy if exists "official notice feed is publicly readable" on public.official_notice_feed;
create policy "official notice feed is publicly readable"
on public.official_notice_feed
for select
to anon, authenticated
using (id = 'current');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'sync-official-notices-every-20-minutes';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

select cron.schedule(
  'sync-official-notices-every-20-minutes',
  '7,27,47 * * * *',
  $$
  select net.http_post(
    url := 'https://iqweoywmawveeehvbbky.supabase.co/functions/v1/sync-notices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2VveXdtYXd2ZWVlaHZiYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MzgzODgsImV4cCI6MjEwMTIxNDM4OH0.k22v3MiyjzWT3ED1Q-G_X0SLvMiRCv-JSoeecAo_7gA',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2VveXdtYXd2ZWVlaHZiYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MzgzODgsImV4cCI6MjEwMTIxNDM4OH0.k22v3MiyjzWT3ED1Q-G_X0SLvMiRCv-JSoeecAo_7gA'
    ),
    body := jsonb_build_object('trigger', 'supabase-cron'),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
