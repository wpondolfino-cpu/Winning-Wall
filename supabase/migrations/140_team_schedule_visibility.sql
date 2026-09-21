-- 140_team_schedule_visibility.sql
--
-- What a player can see on their schedule, separated from what they can
-- see of a practice's plan.
--
-- The database treated those as one thing. A player could read a
-- practice only if it was PUBLISHED and they were attending it, and a
-- game only if its report was published. So a player's schedule was
-- missing every practice not yet planned and every game not yet played —
-- which, a week or two out, is nearly all of it. The schedule even has a
-- "Plan coming" label for draft practices that no player could ever see.
--
-- Now:
--   · the ROW — date, time, team — is visible for your own team, draft or
--     not, and for any practice you've been called up to;
--   · the PLAN — blocks, drills, groups — stays published-only, exactly as
--     before. Nothing here touches those policies.
--
-- Also clears up is_effective_attendee. Migration 123 meant to update it
-- when "excused" became "absent", but rewrote a function called
-- is_attending_practice instead — one that only existed because 123
-- created it. is_effective_attendee kept checking for 'excused', a value
-- that no longer exists.
--
-- Rather than point it at 'absent', the check is removed. Every use of this
-- function is a READ policy — the practice, its blocks, drills and groups —
-- so it only ever decided what a player could see, never who was in
-- today's groups. Hiding the plan from a sick player served no purpose: a
-- player off with the flu is exactly the one who wants to know what they
-- missed. Being on the team, or called up, is what entitles you to see it.
--
-- Who is actually ATTENDING — for groups, headcounts and the warning
-- badge — is worked out separately in the client, and still leaves absent
-- players out. The two answer different questions and now say so.

-- ── Who may see a practice's plan ────────────────────────────
-- The name is historical: it reads as "who's attending", but every caller
-- is a read policy and the question it answers is "who's entitled to see
-- this". Renaming it would mean rewriting six policies for no change in
-- behaviour, so the meaning is recorded here instead.
create or replace function public.is_effective_attendee(p_practice_id uuid, p_player_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1
      from public.practices pr
      join public.profiles pl on pl.id = p_player_id
      where pr.id = p_practice_id
        and pl.home_roster_id = any(pr.roster_ids)
    )
    or exists (
      select 1 from public.practice_attendance_overrides o
      where o.practice_id = p_practice_id
        and o.player_id = p_player_id
        and o.override_type = 'call_up'
    );
$$;

-- Created by 123 by mistake and called by nothing.
drop function if exists public.is_attending_practice(uuid, uuid);

-- ── Practices on a player's schedule ─────────────────────────
-- Not gated on attendance. A player marked absent on Monday still needs to
-- see Monday on the schedule — being out doesn't make the practice stop
-- existing. Unlike the plan, this also covers drafts.
--
-- Security definer because a call-up lives in the attendance overrides,
-- which players can't read directly.
create or replace function public.practice_on_my_schedule(p_practice_id uuid, p_player_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.practices pr
    join public.profiles pl on pl.id = p_player_id
    where pr.id = p_practice_id
      and not pr.is_template
      and pl.home_roster_id = any(pr.roster_ids)
  )
  or exists (
    select 1 from public.practice_attendance_overrides o
    where o.practice_id = p_practice_id
      and o.player_id = p_player_id
      and o.override_type = 'call_up'
  );
$$;

grant execute on function public.practice_on_my_schedule(uuid, uuid) to authenticated;

drop policy if exists "practices_player_read_schedule" on public.practices;
create policy "practices_player_read_schedule" on public.practices
  for select using (public.practice_on_my_schedule(id, auth.uid()));

-- ── Games on a player's schedule ─────────────────────────────
-- A game's "published" means its REPORT is published, so an upcoming game
-- was invisible to players until after it had been played and written up.
-- The row itself — opponent, time, place — is what a schedule needs, and
-- is public anyway. Possessions and the report keep their own gating.
--
-- A game with no team set is shown to everyone rather than no one: a
-- missing roster is a gap in the data, not a sign it's private.
drop policy if exists "games_player_read_schedule" on public.games;
create policy "games_player_read_schedule" on public.games
  for select using (
    roster_id is null
    or exists (
      select 1 from public.profiles pl
      where pl.id = auth.uid() and pl.home_roster_id = games.roster_id
    )
  );

comment on function public.is_effective_attendee(uuid, uuid) is
  'Whether a player may see a published practice''s plan: on its roster, or called up. Not attendance — absent players can still see what they missed. Used only by read policies.';
