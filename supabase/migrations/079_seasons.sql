-- 079_seasons.sql
-- Adds a formal, shared season concept — one active season at a time,
-- used across every team's tab rather than per-team. Weeks (not
-- individual practices) carry the season_id, since a week is already
-- the natural grouping unit the app uses; a season is just one more
-- level of grouping above it.
--
-- "Start new season" (see startNewSeason() in practicePlanner.ts)
-- flips is_current off the old season and inserts a new current one.
-- Existing weeks keep their season_id — nothing is retroactively
-- reassigned. Only newly created weeks pick up the new current season.

create table if not exists public.seasons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_current boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Enforces at most one current season at a time at the database level,
-- not just in application code.
create unique index if not exists seasons_one_current_idx
  on public.seasons (is_current) where is_current;

alter table public.practice_weeks
  add column if not exists season_id uuid references public.seasons(id) on delete set null;

alter table public.seasons enable row level security;

drop policy if exists "seasons_read_all" on public.seasons;
create policy "seasons_read_all" on public.seasons
  for select using (true);

drop policy if exists "seasons_staff_write" on public.seasons;
create policy "seasons_staff_write" on public.seasons
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- Seed one season so existing weeks aren't left with a null season_id,
-- and backfill every week that doesn't have one yet.
insert into public.seasons (name, is_current)
select '2025-26', true
where not exists (select 1 from public.seasons);

update public.practice_weeks
set season_id = (select id from public.seasons where is_current limit 1)
where season_id is null;
