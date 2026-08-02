-- 095_practice_wins.sql
-- Practice Wins: the coach-tapped "winning wall" tracker. One row per
-- player per win (a multi-winner tap just creates multiple rows with
-- the same drill_name/practice_id/logged_at cluster, which is also
-- what undo removes as a group). Deliberately its own table, not
-- merged into the offseason scores/points system — this feeds a
-- separate in-season leaderboard with its own biweekly/season shape.

create table if not exists public.practice_wins (
  id          uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  player_id   uuid not null references public.profiles(id) on delete cascade,
  drill_name  text,
  logged_by   uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists practice_wins_practice_idx on public.practice_wins(practice_id);
create index if not exists practice_wins_player_idx on public.practice_wins(player_id);
create index if not exists practice_wins_created_idx on public.practice_wins(created_at);

alter table public.practice_wins enable row level security;

drop policy if exists "practice_wins_staff_write" on public.practice_wins;
create policy "practice_wins_staff_write" on public.practice_wins
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

-- Players can read practice wins (needed for the in-season leaderboard),
-- but never write them -- entry is coach/admin-only by design.
drop policy if exists "practice_wins_read_all" on public.practice_wins;
create policy "practice_wins_read_all" on public.practice_wins
  for select using (true);
