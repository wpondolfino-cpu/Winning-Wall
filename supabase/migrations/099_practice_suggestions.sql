-- 099_practice_suggestions.sql
-- Extends the existing Goals system (stat_goals) with two new fields
-- per stat, edited in the same GoalsManager screen as the target/
-- direction that already lives there:
--   min_sample_size -- floor below which a stat is never eligible to
--     show up as a weakness/strength (protects against small-sample
--     noise, e.g. a 3PT% built on 3 attempts). Sensible presets get
--     seeded below; fully coach-editable after that, same as
--     direction already is.
--   note -- the coach-authored practice-suggestion text shown only to
--     coaches when this stat is flagged as a weakness. Strengths never
--     show a note by design.
--
-- stat_flag_streaks tracks "chronic vs new": how many report views in
-- a row a given stat has been flagged as a weakness. Updated each time
-- the practice-suggestions computation runs against a report.

alter table public.stat_goals add column if not exists min_sample_size integer;
alter table public.stat_goals add column if not exists note text;

create table if not exists public.stat_flag_streaks (
  id             uuid primary key default gen_random_uuid(),
  stat_key       text not null,
  team           text not null check (team in ('us', 'opponent')),
  current_streak integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (stat_key, team)
);

alter table public.stat_flag_streaks enable row level security;

drop policy if exists "stat_flag_streaks_staff_all" on public.stat_flag_streaks;
create policy "stat_flag_streaks_staff_all" on public.stat_flag_streaks
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- Players see the streak indicator alongside the stat itself, same
-- visibility as the weakness/strength ranking (no notes though --
-- that stays staff-only, enforced at the query/UI level, not RLS,
-- since the note lives on the same stat_goals row a player already
-- needs partial read access to for goal coloring elsewhere).
drop policy if exists "stat_flag_streaks_read_all" on public.stat_flag_streaks;
create policy "stat_flag_streaks_read_all" on public.stat_flag_streaks
  for select using (true);

-- Sensible default sample-size floors for the stats most prone to
-- small-sample noise. Coaches can change any of these in GoalsManager;
-- these just mean the feature is safe on day one without configuration.
-- Only inserted for stat_keys that don't already have a goal row (so
-- this never overwrites something a coach already set).
insert into public.stat_goals (stat_key, team, target_value, direction, min_sample_size, updated_by)
select v.stat_key, v.team, v.target_value, v.direction, v.min_sample_size, p.id
from (values
  ('fg2_pct', 'us', 45, 'higher_better', 10),
  ('fg3_pct', 'us', 33, 'higher_better', 8),
  ('ft_pct',  'us', 65, 'higher_better', 8),
  ('efg_pct', 'us', 48, 'higher_better', 15),
  ('oreb_pct','us', 30, 'higher_better', 10),
  ('tov_pct', 'us', 18, 'lower_better',  10)
) as v(stat_key, team, target_value, direction, min_sample_size)
cross join (select id from public.profiles where role in ('admin','coach') order by created_at limit 1) as p
where not exists (
  select 1 from public.stat_goals g where g.stat_key = v.stat_key and g.team = v.team
);
