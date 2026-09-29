-- 153_inactivity_nudges.sql
--
-- "Inactive" now means hasn't OPENED the app -- not hasn't logged a
-- workout -- so a player reviewing scouts in-season counts as engaged.
--
--   * profiles.last_seen_at: set by the app when someone opens it, at most
--     once a day.
--   * Nudges (sent by daily-reminders at noon):
--       offseason: 14 days, then 28
--       in-season:  7 days, then 14
--     then nothing more until the player opens the app again, which starts
--     the count over. Alumni, inactive and pending accounts are skipped.
--   * Everyone's clock starts the day this runs (last_seen_at = now), so
--     nobody is nudged on day one.

alter table public.profiles add column if not exists last_seen_at timestamptz;
update public.profiles set last_seen_at = now() where last_seen_at is null;

-- ── What was sent, so a re-run never double-sends ────────────
create table if not exists public.inactivity_nudges (
  id        uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  days      integer not null,
  mode      text not null,
  sent_at   timestamptz not null default now()
);
create index if not exists inactivity_nudges_player_idx on public.inactivity_nudges(player_id, sent_at);

alter table public.inactivity_nudges enable row level security;
drop policy if exists "inactivity_nudges_staff_read" on public.inactivity_nudges;
create policy "inactivity_nudges_staff_read" on public.inactivity_nudges
  for select using (public.is_staff(auth.uid()));
-- No write policies: only the daily job writes, with server rights.

-- ── Who's due today ───────────────────────────────────────────
-- stage 1 = first nudge (N days), stage 2 = second (2N days).
-- Days are counted in Eastern calendar days.
create or replace function public.inactivity_nudges_due()
returns table (player_id uuid, days_inactive integer, stage integer, nudge_days integer, mode text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with cfg as (
    select coalesce((select value from public.app_settings where key = 'season_mode'), 'offseason') as mode
  ), cfg2 as (
    select mode, case when mode = 'inseason' then 7 else 14 end as n from cfg
  ), players as (
    select p.id, coalesce(p.last_seen_at, p.created_at) as seen
      from public.profiles p
     where p.role = 'player'
       and coalesce(p.grade_category, '') <> 'Alumni'
       and not (p.graduation_year is not null and p.graduation_year < public.current_academic_year())
  ), counted as (
    select pl.id,
           ((now() at time zone 'America/New_York')::date - (pl.seen at time zone 'America/New_York')::date) as d,
           (select count(*) from public.inactivity_nudges n where n.player_id = pl.id and n.sent_at > pl.seen)::int as sent
      from players pl
  )
  select c.id, c.d, c.sent + 1, (c.sent + 1) * cfg2.n, cfg2.mode
    from counted c, cfg2
   where (c.sent = 0 and c.d >= cfg2.n)
      or (c.sent = 1 and c.d >= 2 * cfg2.n)
$$;

-- Only the server (the daily job) calls it.
revoke all on function public.inactivity_nudges_due() from public, anon, authenticated;
