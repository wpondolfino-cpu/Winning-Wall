-- 062_drill_library.sql
-- Support for the Drill Library feature:
-- 1. library_archived — soft-hide a drill from the library without
--    touching is_active (which is about "currently in the live published
--    group", a different concept) or deleting real history.
-- 2. library_practice_log — enforces "flat practice credit capped at
--    once per drill per day" without limiting how many times a genuine
--    personal best can be earned that same day.

alter table public.workouts
  add column if not exists library_archived boolean not null default false;

create table if not exists public.library_practice_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  practice_date date not null,
  created_at timestamptz not null default now(),
  unique (player_id, workout_id, practice_date)
);

alter table public.library_practice_log enable row level security;

drop policy if exists "own_library_practice_read" on public.library_practice_log;
create policy "own_library_practice_read" on public.library_practice_log
  for select using (auth.uid() = player_id);

drop policy if exists "own_library_practice_insert" on public.library_practice_log;
create policy "own_library_practice_insert" on public.library_practice_log
  for insert with check (auth.uid() = player_id);

drop policy if exists "staff_read_library_practice" on public.library_practice_log;
create policy "staff_read_library_practice" on public.library_practice_log
  for select using (
    auth.uid() in (select id from public.profiles where role in ('coach', 'admin'))
  );
