-- 103_game_call_ups.sql
-- A JV player pulled up for a single varsity game.
--
-- There was already a called_up_to_roster_id column, but it lives on
-- practice_attendance_overrides and is scoped to one practice, so it can't
-- answer "who was available for this game". Hence a table of its own.
--
-- Deliberately per-GAME rather than a flag on the player. A permanent move
-- is a different thing and already has a home: changing home_roster_id in
-- the Players panel. This is for the kid who plays two varsity games in
-- January and goes back down -- recording that as a profile change would
-- rewrite history for every game either side of it.
--
-- Coach-only, like the rest of the lineup tables.

create table if not exists public.game_call_ups (
  game_id    uuid not null references public.games(id) on delete cascade,
  player_id  uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create index if not exists game_call_ups_game_idx on public.game_call_ups(game_id);

alter table public.game_call_ups enable row level security;

drop policy if exists game_call_ups_coach_all on public.game_call_ups;
create policy game_call_ups_coach_all on public.game_call_ups
  for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );
