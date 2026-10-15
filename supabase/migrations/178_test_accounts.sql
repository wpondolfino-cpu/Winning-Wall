-- ============================================================
-- 178_test_accounts.sql
--
-- Test accounts for "View as".
--
-- A test PLAYER gets its own role value, 'test_player'. Every list in
-- the app and database that means "the players" asks for
-- role = 'player' (about 30 places: leaderboards, rosters, attendance,
-- H2H opponents, Class Clash, quiz completion, inactivity nudges, season
-- rollover…), so test players are left out of all of them automatically,
-- including features built later. The app itself loads a test_player as
-- an ordinary player, so the screens look exactly like a real player's.
--
-- Test COACH accounts (yours only) use the normal coach / admin roles —
-- coaches never appear in player lists.
--
-- The accounts themselves are created by the "view-as" server function
-- the first time someone opens the View-as menu for a program.
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;

-- 1. Allow the new role value.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in
  ('player', 'coach', 'admin', 'inactive', 'pending_player', 'pending_coach', 'test_player'));

-- 2. "Any approved account" includes test players (reading frozen
--    leaderboard snapshots uses this).
create or replace function public.is_active_user(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role in ('player', 'test_player', 'coach', 'admin')
  );
$$;

-- 3. A test player can open and take a scout quiz for their team.
--    quiz_roster (who coaches expect to take it) still lists real
--    players only, so completion numbers aren't skewed.
create or replace function public.quiz_on_game_roster(p_quiz uuid, p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.quizzes z
    join public.profiles p on p.id = p_player and p.role in ('player', 'test_player')
    left join public.games g on g.id = z.game_id
    where z.id = p_quiz
      and (
        (cardinality(z.roster_ids) > 0 and p.home_roster_id = any(z.roster_ids))
        or (g.id is not null and exists (
              select 1 from public.game_call_ups c where c.game_id = g.id and c.player_id = p_player))
        or (cardinality(z.roster_ids) = 0 and (g.roster_id is null or p.home_roster_id = g.roster_id))
      )
  )
$$;
revoke all on function public.quiz_on_game_roster(uuid, uuid) from public, anon, authenticated;

commit;

-- Summary
select 'role values allowed' as item, pg_get_constraintdef(oid) as value
from pg_constraint where conname = 'profiles_role_check'
union all
select 'test accounts so far', count(*)::text from public.program_members where is_test;
