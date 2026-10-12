-- 092_keepalive_heartbeat.sql
-- Prevents Supabase's free-tier 7-day inactivity pause. A pg_cron job
-- writes a timestamp to this table every 3 days -- comfortably inside
-- the 7-day window -- which is enough real database activity to reset
-- the inactivity clock. Nothing in the app ever reads or writes this
-- table; it's invisible to players/coaches. RLS is enabled with no
-- policies so it's never reachable via the client API either way --
-- pg_cron itself runs server-side and isn't subject to RLS.

create extension if not exists pg_cron;

create table if not exists public.heartbeat (
  id        int primary key default 1,
  pinged_at timestamptz not null default now(),
  constraint heartbeat_singleton check (id = 1)
);

insert into public.heartbeat (id, pinged_at)
values (1, now())
on conflict (id) do nothing;

alter table public.heartbeat enable row level security;
-- No policies -- intentionally unreachable from the client API.

-- Idempotent: drop any prior job with this name before scheduling,
-- so re-running this migration doesn't create duplicate jobs.
select cron.unschedule(jobid)
from cron.job
where jobname = 'keepalive-heartbeat';

select cron.schedule(
  'keepalive-heartbeat',
  '0 8 */3 * *',  -- 8am UTC, every 3 days
  $$ update public.heartbeat set pinged_at = now() where id = 1; $$
);
