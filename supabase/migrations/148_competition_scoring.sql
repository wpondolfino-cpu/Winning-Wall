-- 148_competition_scoring.sql
--
-- A competition is scored on the offseason leaderboard (points) or the
-- in-season one (practice wins), decided when it starts.
--
--   * points:        top points in each grade group, as before.
--   * practice_wins: most practice wins on each team (home roster),
--                    with ties crowned together as co-champions.
--
-- A competition keeps its scoring after the season switch flips, so one
-- that ran in the offseason still crowns on points if you crown it later.
-- It can be changed any time before it's crowned.

-- ── The setting ───────────────────────────────────────────────
-- Added with a plain default first so every EXISTING competition is
-- 'points' regardless of which way the switch is set right now.
alter table public.competitions
  add column if not exists scored_by text not null default 'points'
  check (scored_by in ('points', 'practice_wins'));

-- New ones -- from the Schedule form or a repeat -- follow the switch.
create or replace function public.competition_default_scoring()
returns text
language sql stable
security definer
set search_path = public
as $$
  select case when (select value from public.app_settings where key = 'season_mode') = 'inseason'
              then 'practice_wins' else 'points' end
$$;

alter table public.competitions
  alter column scored_by set default public.competition_default_scoring();

-- roll_competitions() (147) inserts without naming scored_by, so repeats
-- pick up the default above -- the mode at the moment the repeat starts.

-- ── Champion rows ─────────────────────────────────────────────
-- In-season champions are per team. points holds their win count.
alter table public.biweekly_champions
  add column if not exists team_name text;

-- History snapshots say what their numbers are.
alter table public.period_snapshots
  add column if not exists scored_by text not null default 'points';
