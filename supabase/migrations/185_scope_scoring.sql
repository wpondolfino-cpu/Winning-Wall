-- ============================================================
-- 185_scope_scoring.sql
--
-- MULTI-TENANCY STEP 8c — scoring, competitions, H2H, history.
--
-- Fenced to their program (restrictive "program_scope", as before):
--   scores, score history, personal bests (+ per-spot), streaks, bonus
--   points, points ledger, scoring windows, XP log, perk use and score
--   boosts, competitions, champions, period snapshots, records (Hall of
--   Fame), badges, season / in-season history, H2H challenges (+ pending
--   scores), Class Clash, team competitions and teams, inactivity nudges.
--
-- The ~35 server functions that score, rank and total points now work
-- inside one program. Before this, they ranked across the whole
-- database, so a Girls player could have taken Boys' podium points or
-- been challenged by a Boys player.
--
-- Also:
--   * XP is per program (decision 1): it moves from the player's profile
--     onto their program membership. Boys' XP is copied over exactly.
--     (Ships with 4 app files that read XP: Leaderboard.tsx,
--     AdminPanel.tsx, xp.ts, teams.ts.)
--   * Streaks, records and scoring windows are kept per program.
--   * Records: the table had two overlapping "one record per type"
--     rules, and Postgres refuses to update a record when both exist,
--     so Hall of Fame records have not been updating. Replaced with one
--     per-program rule. Records start updating again after this.
--   * Girls (and any other program) gets a copy of Boys' badge list.
--     No competition is created for Girls -- set one up from the
--     Leaderboard when switched to Girls.
--   * Server jobs (the nightly daily-reminders) now run each program in
--     turn. (Ships with an updated daily-reminders function.)
--   * close_team_competition, which the app calls when a team
--     competition ends with no teams, never existed live (noted in
--     171). Created here, program-scoped.
--
-- SAFETY CHECK BUILT IN: before changing anything it records Boys'
-- overall points per player, XP, streaks, records, current competition
-- standings, live window points and every player's points breakdown.
-- After the changes it recomputes them with the new functions. If a
-- single Boys number differs, the migration stops and nothing changes.
--
-- If Supabase asks about RLS, choose "Run without RLS" (the check uses
-- temporary tables).
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 0. BEFORE: Boys' numbers with the current functions ───────
-- (Server context = Boys, the same as the app today.)
create temp table _b_players on commit preserve rows as
  select m.user_id as player_id
    from public.program_members m
    join public.profiles p on p.id = m.user_id
   where m.program_id = public.legacy_default_program_id() and p.role = 'player';

create temp table _b_points on commit preserve rows as
  select o.player_id, o.total from public.overall_points() o
   where o.player_id in (select player_id from _b_players);

create temp table _b_xp on commit preserve rows as
  select p.id as player_id, coalesce(p.total_xp, 0) as xp
    from public.profiles p
   where p.id in (select user_id from public.program_members
                   where program_id = public.legacy_default_program_id());

create temp table _b_streaks on commit preserve rows as
  select player_id, current_streak, longest_streak, last_logged_date from public.streaks
   where program_id = public.legacy_default_program_id();

create temp table _b_records on commit preserve rows as
  select record_type, workout_id, player_id, value from public.records
   where program_id = public.legacy_default_program_id();

create temp table _b_comp on commit preserve rows as
  select id from public.current_competition() where program_id = public.legacy_default_program_id();

create temp table _b_standings on commit preserve rows as
  select s.player_id, s.points from _b_comp c, public.competition_standings(c.id) s
   where s.player_id in (select player_id from _b_players);

create temp table _b_live on commit preserve rows as
  select wp.player_id, wp.workout_id, wp.points, wp.source
    from public.live_window() lw, public.window_points(lw.starts_at, lw.ends_at, lw.with_placings) wp
   where wp.player_id in (select player_id from _b_players);

create temp table _b_breakdown on commit preserve rows as
  select b.player_id, x.label, x.competition_id, x.points, x.won
    from _b_players b, lateral public.overall_breakdown(b.player_id) x;


-- ── 1. New rows get the program the work is for ───────────────
-- Same as before for people. Server jobs now stamp the program they're
-- working on (they used to always stamp Boys).
create or replace function public.set_program_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.program_id is null then
    new.program_id := public.ctx_program_id();
  end if;
  return new;
end
$$;


-- ── 2. XP lives on the program membership ────────────────────
alter table public.program_members add column if not exists total_xp integer not null default 0;

update public.program_members m
   set total_xp = coalesce(p.total_xp, 0)
  from public.profiles p
 where p.id = m.user_id
   and m.program_id = public.legacy_default_program_id()
   and m.total_xp = 0;

-- A player's XP in the program you're looking at.
create or replace function public.member_xp(p_user uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.total_xp from public.program_members m
   where m.user_id = p_user and m.program_id = public.ctx_program_id()
$$;

-- Everyone's XP in the program you're in (players can't read other
-- members' rows directly).
create or replace function public.program_xp()
returns table(player_id uuid, total_xp integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.user_id, m.total_xp from public.program_members m
   where m.program_id = public.ctx_program_id()
     and auth.uid() is not null
     and public.is_program_member(m.program_id, auth.uid())
$$;

revoke all on function public.member_xp(uuid) from public, anon;
revoke all on function public.program_xp() from public, anon;
grant execute on function public.member_xp(uuid) to authenticated;
grant execute on function public.program_xp() to authenticated;


-- ── 3. Keys that must be per program ─────────────────────────
-- Dropped by what they cover, not by name, in case live names differ.
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
      from pg_constraint c
     where c.contype = 'u'
       and ( (c.conrelid = 'public.records'::regclass
              and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                    where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['record_type','workout_id'])
          or (c.conrelid = 'public.streaks'::regclass
              and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                    where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['player_id'])
          or (c.conrelid = 'public.scoring_windows'::regclass
              and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                    where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['ends_at','starts_at']))
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
  -- Plain unique indexes on the same columns (not constraints)
  for r in
    select i.indexrelid::regclass as idx
      from pg_index i
     where i.indisunique and not i.indisprimary
       and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
       and ( (i.indrelid = 'public.records'::regclass
              and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                    where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['record_type','workout_id'])
          or (i.indrelid = 'public.streaks'::regclass
              and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                    where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['player_id'])
          or (i.indrelid = 'public.scoring_windows'::regclass
              and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                    where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['ends_at','starts_at']))
  loop
    execute format('drop index %s', r.idx);
  end loop;
end $$;

create unique index if not exists records_program_type_workout_key
  on public.records (program_id, record_type, workout_id);
create unique index if not exists streaks_program_player_key
  on public.streaks (program_id, player_id);
create unique index if not exists scoring_windows_program_window_key
  on public.scoring_windows (program_id, starts_at, ends_at);


-- ── 4. Badges: every other program gets Boys' list ───────────
insert into public.badges (program_id, icon, name, description, trigger_type, trigger_value, is_active, created_at)
select p.id, b.icon, b.name, b.description, b.trigger_type, b.trigger_value, b.is_active, now()
  from public.programs p
  cross join public.badges b
 where b.program_id = public.legacy_default_program_id()
   and p.id <> public.legacy_default_program_id()
   and not exists (select 1 from public.badges x where x.program_id = p.id and x.name = b.name);


-- ── 5. The program fence ──────────────────────────────────────
select public.add_program_scope(t) from unnest(array[
  'scores',
  'score_attempts',
  'personal_bests',
  'spot_personal_bests',
  'streaks',
  'streak_bonuses',
  'points_ledger',
  'scoring_windows',
  'xp_log',
  'perk_usage',
  'perk_boosts',
  'competitions',
  'biweekly_champions',
  'period_snapshots',
  'records',
  'badges',
  'season_history',
  'inseason_history',
  'challenges',
  'challenge_pending_scores',
  'class_clash_competitions',
  'team_competitions',
  'teams',
  'inactivity_nudges'
]) as t;

-- Views that read these tables run as the person looking.
alter view public.challenge_stats     set (security_invoker = true);
alter view public.inactive_players    set (security_invoker = true);
alter view public.workouts_with_group set (security_invoker = true);


-- ── 6. Scoring functions, one program at a time ───────────────

-- Streak: one per player per program.
create or replace function public._scoring_streak(p_player uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid uuid := public.ctx_program_id();
  v_today date := public.app_date();
  s public.streaks%rowtype;
  v_new int := 1;
  v_bonus boolean := false;
begin
  select * into s from public.streaks where player_id = p_player and program_id = v_pid;
  if found then
    if s.last_logged_date = v_today then
      return jsonb_build_object('streak', s.current_streak, 'streak_bonus', false);
    elsif s.last_logged_date = v_today - 1 then
      v_new := s.current_streak + 1;
    end if;
  end if;
  if floor(v_new / 7.0) > floor(coalesce(s.current_streak, 0) / 7.0)
     and coalesce(s.bonus_awarded_at, date '1900-01-01') <> v_today then
    v_bonus := true;
    insert into public.streak_bonuses (program_id, player_id, points, streak_length, awarded_at, reason)
    values (v_pid, p_player, 3, v_new, now(), 'streak');
  end if;
  insert into public.streaks (program_id, player_id, current_streak, longest_streak, last_logged_date, bonus_awarded_at)
  values (v_pid, p_player, v_new, v_new, v_today, case when v_bonus then v_today end)
  on conflict (program_id, player_id) do update set
    current_streak   = excluded.current_streak,
    longest_streak   = greatest(public.streaks.longest_streak, excluded.current_streak),
    last_logged_date = excluded.last_logged_date,
    bonus_awarded_at = case when v_bonus then v_today else public.streaks.bonus_awarded_at end;
  return jsonb_build_object('streak', v_new, 'streak_bonus', v_bonus);
end;
$function$;

-- XP goes to the membership in this program.
create or replace function public._award_xp(p_player uuid, p_key text, p_default integer, p_reason text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid uuid := public.ctx_program_id();
  v_amount int;
begin
  select coalesce((select xp_required from public.xp_settings
                    where perk_key = p_key and program_id = v_pid), p_default) into v_amount;
  if v_amount <= 0 then return 0; end if;
  insert into public.xp_log (program_id, player_id, xp_amount, reason) values (v_pid, p_player, v_amount, p_reason);
  update public.program_members set total_xp = total_xp + v_amount
   where user_id = p_player and program_id = v_pid;
  return v_amount;
end;
$function$;

create or replace function public._scoring_xp(p_player uuid, p_workout uuid, p_reason text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid uuid := public.ctx_program_id();
  v_today_count int;
  v_amount int;
begin
  -- Counted after this log's entry is written, so <= 3 means first three.
  select count(*) into v_today_count from public.score_attempts
   where player_id = p_player and workout_id = p_workout and public.app_date(attempted_at) = public.app_date();
  if v_today_count > 3 then return 0; end if;
  select coalesce((select xp_required from public.xp_settings
                    where perk_key = '_xp_workout' and program_id = v_pid), 10) into v_amount;
  insert into public.xp_log (program_id, player_id, xp_amount, reason) values (v_pid, p_player, v_amount, p_reason);
  update public.program_members set total_xp = total_xp + v_amount
   where user_id = p_player and program_id = v_pid;
  return v_amount;
end;
$function$;

-- Drills can only be logged in the program they belong to.
create or replace function public.log_library_practice(p_workout_id uuid, p_made integer DEFAULT 0, p_reps integer DEFAULT 0, p_sprint_secs numeric DEFAULT 0, p_self_points integer DEFAULT 0)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_player uuid := auth.uid();
  w public.workouts%rowtype;
  v_dir int;
  v_raw numeric;
  v_credited boolean := false;
  v_pb jsonb;
  v_pb_bonus boolean := false;
  v_streak jsonb;
  v_xp int;
begin
  if v_player is null then raise exception 'Sign in to log a workout.' using errcode = '42501'; end if;
  select * into w from public.workouts where id = p_workout_id;
  if not found then raise exception 'That drill no longer exists.'; end if;
  if w.program_id is distinct from public.ctx_program_id() then
    raise exception 'That drill isn''t in the program you''re in.' using errcode = '42501';
  end if;
  perform public._scoring_check(p_made, p_reps, p_sprint_secs, p_self_points, w.allow_negative);

  v_dir := case when coalesce(w.lower_is_better, false) then -1 else 1 end;
  v_raw := public.raw_result(p_made, p_reps, p_sprint_secs, p_self_points);

  -- +1 once per drill per day.
  insert into public.library_practice_log (player_id, workout_id, practice_date)
  values (v_player, p_workout_id, public.app_date())
  on conflict (player_id, workout_id, practice_date) do nothing;
  v_credited := found;
  if v_credited then
    insert into public.streak_bonuses (player_id, points, streak_length, awarded_at, reason, workout_id)
    values (v_player, 1, 0, now(), 'extra_reps', p_workout_id);
  end if;

  insert into public.score_attempts (player_id, workout_id, made, reps, sprint_secs, self_points, raw_score, is_personal_best, attempted_at)
  values (v_player, p_workout_id, coalesce(p_made, 0), coalesce(p_reps, 0), coalesce(p_sprint_secs, 0), coalesce(p_self_points, 0), v_raw, false, now());

  v_pb := public._scoring_personal_best(v_player, p_workout_id, v_raw, v_dir);
  if (v_pb->>'is_personal_best')::boolean and v_pb->>'previous_best' is not null then
    insert into public.streak_bonuses (player_id, points, streak_length, awarded_at, reason, workout_id)
    values (v_player, 1, 0, now(), 'personal_best', p_workout_id);
    v_pb_bonus := true;
  end if;

  v_streak := public._scoring_streak(v_player);
  v_xp := public._scoring_xp(v_player, p_workout_id, 'library_practice');

  return jsonb_build_object(
    'raw', v_raw,
    'credited_today', v_credited,
    'is_personal_best', coalesce((v_pb->>'is_personal_best')::boolean, false),
    'previous_best', v_pb->'previous_best',
    'overtaken_player', v_pb->'overtaken_player',
    'personal_best_bonus', v_pb_bonus,
    'streak', v_streak->'streak',
    'streak_bonus', v_streak->'streak_bonus',
    'xp', v_xp
  );
end;
$function$;

create or replace function public.log_workout(p_workout_id uuid, p_made integer DEFAULT 0, p_reps integer DEFAULT 0, p_sprint_secs numeric DEFAULT 0, p_self_points integer DEFAULT 0, p_tiebreak_value numeric DEFAULT NULL::numeric, p_spot_scores numeric[] DEFAULT NULL::numeric[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_player uuid := auth.uid();
  w public.workouts%rowtype;
  v_group_status text;
  v_today date := public.app_date();
  v_run int;
  v_dir int;
  v_raw numeric;
  v_self int := coalesce(p_self_points, 0);
  e public.scores%rowtype;
  v_had boolean;
  v_better boolean := false;
  v_flat_awarded boolean := false;
  v_pb jsonb;
  v_pb_bonus boolean := false;
  v_streak jsonb;
  v_xp int;
  v_spots jsonb;
  i int;
  v_spot numeric;
  v_is_time boolean;
begin
  if v_player is null then raise exception 'Sign in to log a workout.' using errcode = '42501'; end if;
  select * into w from public.workouts where id = p_workout_id;
  if not found then raise exception 'That drill no longer exists.'; end if;
  if w.program_id is distinct from public.ctx_program_id() then
    raise exception 'That drill isn''t in the program you''re in.' using errcode = '42501';
  end if;
  if w.is_active = false then
    return public.log_library_practice(p_workout_id, p_made, p_reps, p_sprint_secs, p_self_points);
  end if;

  perform public._scoring_check(p_made, p_reps, p_sprint_secs, p_self_points, w.allow_negative);

  v_run := coalesce(w.current_run, 1);
  v_dir := case when coalesce(w.lower_is_better, false) then -1 else 1 end;
  if w.scoring_type = 'flat' then v_self := coalesce(w.flat_points, 1); end if;
  v_raw := public.raw_result(p_made, p_reps, p_sprint_secs, v_self);
  if w.scoring_type <> 'flat' and v_raw = 0 then
    raise exception 'Please enter a score before submitting.' using errcode = '22023';
  end if;

  select * into e from public.scores where player_id = v_player and workout_id = p_workout_id;
  v_had := found;

  if w.scoring_type = 'flat' then
    -- Flat points once a day, adding up across days.
    if not exists (
      select 1 from public.points_ledger
       where player_id = v_player and workout_id = p_workout_id and source = 'flat'
         and public.app_date(earned_at) = v_today
    ) and not (v_had and e.last_logged_date = v_today) then
      v_flat_awarded := true;
      if public.scoring_started_at() is not null then
        insert into public.points_ledger (player_id, points, source, workout_id)
        values (v_player, v_self, 'flat', p_workout_id);
      end if;
      insert into public.scores (player_id, workout_id, made, reps, sprint_secs, self_points, points, last_logged_date, run)
      values (v_player, p_workout_id, coalesce(p_made, 0), coalesce(p_reps, 0), coalesce(p_sprint_secs, 0), v_self, v_self, v_today, v_run)
      on conflict (player_id, workout_id) do update set
        points = coalesce(public.scores.points, 0) + excluded.self_points,
        self_points = excluded.self_points, last_logged_date = excluded.last_logged_date;
    end if;

  elsif w.scoring_type = 'self_reported' then
    -- Latest entry counts.
    insert into public.scores (player_id, workout_id, made, reps, sprint_secs, self_points, points, last_logged_date, run)
    values (v_player, p_workout_id, coalesce(p_made, 0), coalesce(p_reps, 0), coalesce(p_sprint_secs, 0), v_self, v_self, v_today, v_run)
    on conflict (player_id, workout_id) do update set
      made = excluded.made, reps = excluded.reps, sprint_secs = excluded.sprint_secs,
      self_points = excluded.self_points, points = excluded.points,
      last_logged_date = excluded.last_logged_date, run = excluded.run, logged_at = now();

  else
    -- Competitive / multi-spot: the season's saved result is replaced only
    -- by a better one (result vs result, respecting lower-is-better), or
    -- when the drill has been re-run since it was saved.
    v_better := not v_had
             or coalesce(e.run, 1) <> v_run
             or v_raw * v_dir > public.raw_result(e.made, e.reps, e.sprint_secs, e.self_points) * v_dir;
    if v_better then
      insert into public.scores (player_id, workout_id, made, reps, sprint_secs, self_points, tiebreak_value, spot_scores, points, last_logged_date, run)
      values (v_player, p_workout_id, coalesce(p_made, 0), coalesce(p_reps, 0), coalesce(p_sprint_secs, 0), v_self, p_tiebreak_value, p_spot_scores, 0, v_today, v_run)
      on conflict (player_id, workout_id) do update set
        made = excluded.made, reps = excluded.reps, sprint_secs = excluded.sprint_secs,
        self_points = excluded.self_points, tiebreak_value = excluded.tiebreak_value,
        spot_scores = excluded.spot_scores, last_logged_date = excluded.last_logged_date,
        run = excluded.run, logged_at = now();
    else
      update public.scores set last_logged_date = v_today where player_id = v_player and workout_id = p_workout_id;
    end if;
    select status into v_group_status from public.workout_groups where id = w.group_id;
    if w.group_id is null or v_group_status = 'active' or v_group_status is null then
      perform public.rerank_workout(p_workout_id, coalesce(w.first_place_pts, 5), coalesce(w.second_place_pts, 3), coalesce(w.third_place_pts, 1));
    end if;
  end if;

  -- Every log goes into History.
  insert into public.score_attempts (player_id, workout_id, made, reps, sprint_secs, self_points, tiebreak_value, spot_scores, raw_score, is_personal_best, attempted_at, run)
  values (v_player, p_workout_id, coalesce(p_made, 0), coalesce(p_reps, 0), coalesce(p_sprint_secs, 0), v_self, p_tiebreak_value, p_spot_scores, v_raw, false, now(), v_run);

  -- All-time personal best; +1 for beating a previous one on ranked drills.
  if w.scoring_type <> 'flat' then
    v_pb := public._scoring_personal_best(v_player, p_workout_id, v_raw, v_dir);
    if (v_pb->>'is_personal_best')::boolean then
      update public.score_attempts set is_personal_best = true
       where id = (select id from public.score_attempts where player_id = v_player and workout_id = p_workout_id order by attempted_at desc limit 1);
      if w.scoring_type in ('competitive', 'multi_spot') and v_pb->>'previous_best' is not null then
        insert into public.streak_bonuses (player_id, points, streak_length, awarded_at, reason, workout_id)
        values (v_player, 1, 0, now(), 'personal_best', p_workout_id);
        v_pb_bonus := true;
      end if;
    end if;
  else
    v_pb := jsonb_build_object('is_personal_best', v_flat_awarded, 'previous_best', null, 'overtaken_player', null);
  end if;

  -- Per-spot bests (multi-spot). Time drills: lower is better.
  if w.scoring_type = 'multi_spot' and p_spot_scores is not null then
    v_spots := coalesce(w.spot_config, '[]'::jsonb);
    v_is_time := lower(coalesce(w.scoring_metric, '')) like '%fastest%' or lower(coalesce(w.scoring_metric, '')) like '%second%';
    for i in 1 .. coalesce(array_length(p_spot_scores, 1), 0) loop
      v_spot := p_spot_scores[i];
      if v_spot is not null and v_spot > 0 then
        insert into public.spot_personal_bests (player_id, workout_id, spot_index, spot_name, best_score, achieved_at)
        values (v_player, p_workout_id, i - 1, coalesce(v_spots->>(i - 1), 'Spot ' || i), round(v_spot)::int, now())
        on conflict (player_id, workout_id, spot_index) do update set
          best_score = excluded.best_score, spot_name = excluded.spot_name, achieved_at = excluded.achieved_at
        where (v_is_time and excluded.best_score < public.spot_personal_bests.best_score)
           or (not v_is_time and excluded.best_score > public.spot_personal_bests.best_score);
      end if;
    end loop;
  end if;

  v_streak := public._scoring_streak(v_player);
  v_xp := public._scoring_xp(v_player, p_workout_id, 'workout_attempt');

  return jsonb_build_object(
    'raw', v_raw,
    'is_personal_best', coalesce((v_pb->>'is_personal_best')::boolean, false),
    'previous_best', v_pb->'previous_best',
    'overtaken_player', v_pb->'overtaken_player',
    'personal_best_bonus', v_pb_bonus,
    'flat_awarded', v_flat_awarded,
    'streak', v_streak->'streak',
    'streak_bonus', v_streak->'streak_bonus',
    'xp', v_xp
  );
end;
$function$;

-- "Did every drill today" bonus counts only your program's drills.
create or replace function public.claim_daily_completion()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_player uuid := auth.uid();
  v_pid uuid := public.ctx_program_id();
  v_today date := public.app_date();
  v_total int;
  v_done int;
  v_group text;
  v_groups int;
begin
  if v_player is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select count(distinct group_name), min(group_name) into v_groups, v_group
    from public.workouts
   where program_id = v_pid
     and coalesce(is_active, true) and (publish_date is null or publish_date <= v_today) and group_name is not null;

  with ranked as (
    select id from public.workouts
     where program_id = v_pid
       and coalesce(is_active, true) and (publish_date is null or publish_date <= v_today)
       and scoring_type in ('competitive', 'multi_spot') and coalesce(leaderboard_active, true)
       and (v_groups <> 1 or group_name = v_group)
  )
  select count(*), count(*) filter (where exists (
           select 1 from public.score_attempts a
            where a.player_id = v_player and a.workout_id = ranked.id and public.app_date(a.attempted_at) = v_today))
    into v_total, v_done
    from ranked;

  if v_total > 0 and v_done >= v_total and not exists (
    select 1 from public.streak_bonuses
     where player_id = v_player and program_id = v_pid
       and reason = 'daily_completion' and public.app_date(awarded_at) = v_today
  ) then
    insert into public.streak_bonuses (program_id, player_id, points, streak_length, awarded_at, reason)
    values (v_pid, v_player, 1, 0, now(), 'daily_completion');
    return jsonb_build_object('completed', v_done, 'total', v_total, 'awarded', true);
  end if;
  return jsonb_build_object('completed', v_done, 'total', v_total, 'awarded', false);
end;
$function$;

-- Placings: ranked only among this program's drills (so only its players).
create or replace function public.window_points(p_start timestamp with time zone, p_end timestamp with time zone, p_with_placings boolean)
 returns table(player_id uuid, workout_id uuid, points integer, source text, best_raw numeric, place integer)
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  with w as (
    select wk.id, wk.scoring_type,
           case when coalesce(wk.lower_is_better, false) then -1 else 1 end as dir,
           case wk.tiebreak_mode
             when 'fastest_time' then -1
             when 'free_throw' then 1
             when 'spot' then case when coalesce(wk.lower_is_better, false) then -1 else 1 end
             else 0 end as tie_dir,
           coalesce(wk.first_place_pts, 5) as p1, coalesce(wk.second_place_pts, 3) as p2,
           coalesce(wk.third_place_pts, 1) as p3, coalesce(wk.current_run, 1) as run
      from public.workouts wk
      left join public.workout_groups g on g.id = wk.group_id
     where wk.program_id = public.ctx_program_id()
       and coalesce(wk.is_active, true) and (g.id is null or g.status = 'active')
  ),
  att as (
    select a.player_id, a.workout_id, a.attempted_at, a.tiebreak_value, a.self_points,
           coalesce(a.run, 1) as run,
           public.raw_result(a.made, a.reps, a.sprint_secs, a.self_points) as raw
      from public.score_attempts a
     where a.attempted_at >= p_start and a.attempted_at < p_end
  ),
  boost as (
    select b.player_id, b.workout_id, sum(b.points) as pts
      from public.perk_boosts b
     where b.used_at >= p_start and b.used_at < p_end
     group by b.player_id, b.workout_id
  ),
  best as (
    select distinct on (att.player_id, att.workout_id)
           att.player_id, att.workout_id,
           -- Score Boost: +5 on this competition's best (in the drill's
           -- "better" direction, so lower-is-better drills go down).
           att.raw + coalesce(bo.pts, 0) * w.dir as raw,
           att.tiebreak_value, w.dir, w.tie_dir, w.p1, w.p2, w.p3
      from att join w on w.id = att.workout_id
      left join boost bo on bo.player_id = att.player_id and bo.workout_id = att.workout_id
     where p_with_placings and w.scoring_type in ('competitive', 'multi_spot') and att.run = w.run
     order by att.player_id, att.workout_id, att.raw * w.dir desc,
              (att.tiebreak_value is null), att.tiebreak_value * w.tie_dir desc nulls last
  ),
  ranked as (
    select b.*, dense_rank() over (
             partition by b.workout_id, p.grade_category
             order by b.raw * b.dir desc, (b.tiebreak_value is null), b.tiebreak_value * b.tie_dir desc nulls last
           ) as rnk
      from best b join public.profiles p on p.id = b.player_id
     where p.grade_category is not null
  ),
  self_rep as (
    select distinct on (att.player_id, att.workout_id) att.player_id, att.workout_id, att.self_points
      from att join w on w.id = att.workout_id
     where w.scoring_type = 'self_reported'
     order by att.player_id, att.workout_id, att.attempted_at desc
  )
  select r.player_id, r.workout_id,
         (case r.rnk when 1 then r.p1 when 2 then r.p2 when 3 then r.p3 else 0 end)::int,
         'placing', r.raw, r.rnk::int
    from ranked r
   where r.rnk <= 3
  union all
  select s.player_id, s.workout_id, s.self_points::int, 'self_reported', s.self_points::numeric, null
    from self_rep s
   where coalesce(s.self_points, 0) > 0
$function$;


-- ── 7. Competitions, one program at a time ────────────────────

-- Start the next repeating competition. Called by a person: their
-- program. Called by the nightly job (no person): every program.
create or replace function public._roll_competitions_one()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pid  uuid := public.ctx_program_id();
  last   public.competitions%rowtype;
  s      timestamptz;
  e      timestamptz;
  made   int := 0;
begin
  loop
    select * into last from public.competitions where program_id = v_pid order by ends_at desc limit 1;
    exit when not found or not last.repeats or last.ends_at > now() or made >= 100;

    s := last.ends_at;
    -- Lengths are added in local time, so a boundary stays at midnight
    -- across a daylight-saving change.
    e := case last.length_kind
      when 'day'       then ((s at time zone public.app_timezone()) + interval '1 day')   at time zone public.app_timezone()
      when 'week'      then ((s at time zone public.app_timezone()) + interval '7 days')  at time zone public.app_timezone()
      when 'two_weeks' then ((s at time zone public.app_timezone()) + interval '14 days') at time zone public.app_timezone()
      when 'month'     then ((s at time zone public.app_timezone()) + interval '1 month') at time zone public.app_timezone()
      else s + (last.ends_at - last.starts_at)
    end;

    insert into public.competitions (program_id, name, starts_at, ends_at, length_kind, repeats, created_by)
    values (v_pid, public.competition_default_name(s, e), s, e, last.length_kind, true, last.created_by);
    made := made + 1;
  end loop;
  return made;
end;
$function$;

create or replace function public.roll_competitions()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  pr record;
  made int := 0;
begin
  if auth.uid() is null and coalesce(current_setting('ww.program_id', true), '') = '' then
    for pr in select id from public.programs order by created_at loop
      perform set_config('ww.program_id', pr.id::text, true);
      made := made + public._roll_competitions_one();
    end loop;
    perform set_config('ww.program_id', '', true);
    return made;
  end if;
  return public._roll_competitions_one();
end;
$function$;

create or replace function public.current_competition()
 returns setof competitions
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.roll_competitions();
  return query
    select * from public.competitions
     where program_id = public.ctx_program_id()
       and starts_at <= now() and ends_at > now()
     limit 1;
end;
$function$;

create or replace function public.live_window()
 returns table(starts_at timestamp with time zone, ends_at timestamp with time zone, competition_id uuid, with_placings boolean)
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  with v as (select public.scoring_started_at() as started, public.ctx_program_id() as pid),
  cur as (
    select c.id, c.starts_at, c.ends_at from public.competitions c, v
     where c.program_id = v.pid and c.starts_at <= now() and c.ends_at > now() limit 1
  )
  select greatest(cur.starts_at, v.started), cur.ends_at, cur.id, true from cur, v
   where v.started is not null
  union all
  select greatest(v.started, coalesce((select max(c.ends_at) from public.competitions c
                                        where c.program_id = v.pid and c.ends_at <= now()), v.started)),
         now(), null::uuid, false
    from v
   where v.started is not null and not exists (select 1 from cur)
$function$;

create or replace function public.competition_standings(p_competition_id uuid)
 returns table(player_id uuid, points bigint)
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  with c as (select starts_at, ends_at, program_id from public.competitions
              where id = p_competition_id and program_id = public.ctx_program_id()),
  pts as (
    select wp.player_id, wp.points::bigint as points from c, public.window_points(c.starts_at, c.ends_at, true) wp
    union all
    select b.player_id, b.points::bigint from public.streak_bonuses b, c
     where b.program_id = c.program_id and b.awarded_at >= c.starts_at and b.awarded_at < c.ends_at
  )
  select player_id, sum(points) from pts group by player_id
$function$;

create or replace function public.finalize_window(p_start timestamp with time zone, p_end timestamp with time zone, p_competition_id uuid, p_with_placings boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_pid uuid := public.ctx_program_id();
begin
  if p_end <= p_start then return; end if;
  insert into public.scoring_windows (program_id, starts_at, ends_at, competition_id)
  values (v_pid, p_start, p_end, p_competition_id)
  on conflict (program_id, starts_at, ends_at) do nothing;
  if not found then return; end if;  -- already totalled
  insert into public.points_ledger (program_id, player_id, points, source, workout_id, competition_id, window_start, window_end, earned_at)
  select v_pid, wp.player_id, wp.points, wp.source, wp.workout_id, p_competition_id, p_start, p_end, p_end
    from public.window_points(p_start, p_end, p_with_placings) wp
   where wp.points > 0;
end;
$function$;

create or replace function public._finalize_scoring_windows_one()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid     uuid := public.ctx_program_id();
  v_started timestamptz := public.scoring_started_at();
  v_cursor  timestamptz;
  c record;
begin
  if v_started is null then return; end if;
  v_cursor := v_started;
  for c in
    select id, starts_at, ends_at from public.competitions
     where program_id = v_pid and ends_at > v_started order by starts_at
  loop
    -- The pause before this competition, if any.
    if c.starts_at > v_cursor and c.starts_at <= now() then
      perform public.finalize_window(v_cursor, c.starts_at, null, false);
    end if;
    if c.ends_at <= now() then
      perform public.finalize_window(greatest(c.starts_at, v_started), c.ends_at, c.id, true);
    end if;
    v_cursor := greatest(v_cursor, c.ends_at);
  end loop;
end;
$function$;

create or replace function public.finalize_scoring_windows()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare pr record;
begin
  if auth.uid() is null and coalesce(current_setting('ww.program_id', true), '') = '' then
    for pr in select id from public.programs order by created_at loop
      perform set_config('ww.program_id', pr.id::text, true);
      perform public._finalize_scoring_windows_one();
    end loop;
    perform set_config('ww.program_id', '', true);
    return;
  end if;
  perform public._finalize_scoring_windows_one();
end;
$function$;

create or replace function public.overall_points()
 returns table(player_id uuid, total bigint)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid     uuid := public.ctx_program_id();
  v_started timestamptz := public.scoring_started_at();
begin
  if v_started is null then return; end if;
  perform public._finalize_scoring_windows_one();
  return query
    with pts as (
      select l.player_id, l.points::bigint as points from public.points_ledger l
       where l.program_id = v_pid
      union all
      select b.player_id, b.points::bigint from public.streak_bonuses b
       where b.program_id = v_pid and b.awarded_at >= v_started
      union all
      select wp.player_id, wp.points::bigint
        from public.live_window() lw, public.window_points(lw.starts_at, lw.ends_at, lw.with_placings) wp
    )
    select p.id, coalesce(sum(pts.points), 0)::bigint
      from public.profiles p left join pts on pts.player_id = p.id
     where p.role = 'player'
       and exists (select 1 from public.program_members m where m.user_id = p.id and m.program_id = v_pid)
     group by p.id;
end;
$function$;

create or replace function public.overall_breakdown(p_player uuid)
 returns table(label text, competition_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, points bigint, running boolean, won boolean)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid     uuid := public.ctx_program_id();
  v_started timestamptz := public.scoring_started_at();
begin
  if v_started is null then return; end if;
  perform public._finalize_scoring_windows_one();
  return query
    with windows as (
      select sw.starts_at as s, sw.ends_at as e, sw.competition_id as cid, false as live
        from public.scoring_windows sw
       where sw.program_id = v_pid
      union all
      select lw.starts_at, lw.ends_at, lw.competition_id, true from public.live_window() lw
    ),
    per as (
      select w.s, w.e, w.cid, w.live,
             coalesce((select sum(l.points) from public.points_ledger l
                        where l.program_id = v_pid and l.player_id = p_player and l.source in ('placing', 'self_reported')
                          and l.window_start = w.s and l.window_end = w.e and not w.live), 0)
           + coalesce((select sum(wp.points) from public.window_points(w.s, w.e, w.cid is not null) wp
                        where w.live and wp.player_id = p_player), 0)
           + coalesce((select sum(l.points) from public.points_ledger l
                        where l.program_id = v_pid and l.player_id = p_player and l.source = 'flat'
                          and l.earned_at >= w.s and l.earned_at < w.e), 0)
           + coalesce((select sum(b.points) from public.streak_bonuses b
                        where b.program_id = v_pid and b.player_id = p_player
                          and b.awarded_at >= greatest(w.s, v_started) and b.awarded_at < w.e), 0)
             as pts
        from windows w
    )
    select 'Before competitions began'::text, null::uuid, null::timestamptz, v_started,
           coalesce(sum(l.points), 0)::bigint, false, false
      from public.points_ledger l
     where l.program_id = v_pid and l.player_id = p_player and l.source = 'baseline'
    having coalesce(sum(l.points), 0) <> 0
    union all
    select coalesce(c.name, 'Between competitions'), per.cid, per.s, per.e, per.pts::bigint, per.live,
           exists (select 1 from public.biweekly_champions bc where bc.competition_id = per.cid and bc.player_id = p_player)
      from per left join public.competitions c on c.id = per.cid
     where per.pts <> 0 or per.cid is not null
     order by 3 nulls first;
end;
$function$;

-- Crowning links to the program's own competition.
create or replace function public.link_champion_to_competition()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  cid uuid;
begin
  if tg_op = 'INSERT' then
    cid := new.competition_id;
    if cid is null then
      select id into cid from public.competitions
       where program_id = coalesce(new.program_id, public.ctx_program_id())
         and abs(extract(epoch from ends_at - new.period_end)) < 86400
       order by abs(extract(epoch from ends_at - new.period_end))
       limit 1;
      new.competition_id := cid;
    end if;
    if cid is not null then
      update public.competitions
         set crowned_at = coalesce(crowned_at, new.crowned_at, now()), skipped_at = null
       where id = cid;
    end if;
    return new;
  else
    if old.competition_id is not null
       and not exists (select 1 from public.biweekly_champions
                        where competition_id = old.competition_id and id <> old.id) then
      update public.competitions set crowned_at = null where id = old.competition_id;
    end if;
    return old;
  end if;
end;
$function$;


-- ── 8. Perks ──────────────────────────────────────────────────
create or replace function public._perk_ready(p_perk text)
 returns table(competition_id uuid, period_key date)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_me uuid := auth.uid();
  v_pid uuid := public.ctx_program_id();
  c record;
  v_needed int;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select id, starts_at into c from public.competitions
   where program_id = v_pid and starts_at <= now() and ends_at > now() limit 1;
  if not found then raise exception 'No competition is running right now.'; end if;
  if public.xp_system_on() then
    select xp_required into v_needed from public.xp_settings
     where perk_key = p_perk and program_id = v_pid;
  end if;
  if v_needed is not null and coalesce(public.member_xp(v_me), 0) < v_needed then
    raise exception 'You unlock this perk at % XP.', v_needed using errcode = '42501';
  end if;
  if exists (select 1 from public.perk_usage where program_id = v_pid and player_id = v_me and perk_key = p_perk
              and period_start = (c.starts_at at time zone 'UTC')::date) then
    raise exception 'Already used this competition.';
  end if;
  return query select c.id, (c.starts_at at time zone 'UTC')::date;
end;
$function$;

create or replace function public.use_streak_shield()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_me uuid := auth.uid();
  v_pid uuid := public.ctx_program_id();
  v_today date := public.app_date();
  r record;
  s public.streaks%rowtype;
begin
  select * into r from public._perk_ready('streak_shield');
  select * into s from public.streaks where player_id = v_me and program_id = v_pid;
  if not found or coalesce(s.current_streak, 0) = 0 then
    raise exception 'You don''t have a streak to protect yet.';
  end if;
  if s.last_logged_date >= v_today - 1 then
    raise exception 'Your streak is safe — log today to keep it going. Save the shield for a day you miss.';
  end if;
  if s.last_logged_date < v_today - 2 then
    raise exception 'The shield covers one missed day, and your streak has been broken for longer.';
  end if;
  -- Missed exactly yesterday: count yesterday as logged. Logging today
  -- then continues the streak.
  update public.streaks set last_logged_date = v_today - 1 where player_id = v_me and program_id = v_pid;
  insert into public.perk_usage (program_id, player_id, perk_key, period_start) values (v_pid, v_me, 'streak_shield', r.period_key);
  return jsonb_build_object('streak', s.current_streak);
end;
$function$;

create or replace function public.use_score_boost(p_workout_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_me uuid := auth.uid();
  v_pid uuid := public.ctx_program_id();
  r record;
  c record;
  w public.workouts%rowtype;
begin
  select * into r from public._perk_ready('score_boost');
  select starts_at, ends_at into c from public.competitions where id = r.competition_id;
  select * into w from public.workouts where id = p_workout_id and program_id = v_pid;
  if not found or w.scoring_type not in ('competitive', 'multi_spot') then
    raise exception 'Score Boost works on ranked drills only.';
  end if;
  if not exists (select 1 from public.score_attempts where player_id = v_me and workout_id = p_workout_id
                  and attempted_at >= c.starts_at and attempted_at < c.ends_at) then
    raise exception 'Log % in this competition first, then boost it.', w.title;
  end if;
  insert into public.perk_boosts (program_id, player_id, workout_id, competition_id, points) values (v_pid, v_me, p_workout_id, r.competition_id, 5);
  insert into public.perk_usage (program_id, player_id, perk_key, period_start) values (v_pid, v_me, 'score_boost', r.period_key);
  return jsonb_build_object('workout', w.title, 'points', 5);
end;
$function$;


-- ── 9. H2H challenges: only players in your program ──────────
create or replace function public._challenge_blocked(p_from uuid, p_to uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid uuid := public.ctx_program_id();
  t public.profiles%rowtype;
  v_days int := case when (select value from public.app_settings
                            where key = 'season_mode' and program_id = v_pid) = 'inseason'
                     then 7 else 14 end;
  v_threshold int := public.challenge_xp_threshold();
  v_last_default timestamptz;
begin
  if p_from = p_to then return 'You can''t challenge yourself.'; end if;
  select * into t from public.profiles where id = p_to;
  if not found or t.role <> 'player'
     or not exists (select 1 from public.program_members m where m.user_id = p_to and m.program_id = v_pid) then
    return 'That player can''t be challenged.';
  end if;
  if coalesce(public.member_xp(p_to), 0) < v_threshold then return t.name || ' hasn''t unlocked challenges yet.'; end if;
  if coalesce(t.last_seen_at, t.created_at) < now() - make_interval(days => v_days) then
    return t.name || ' hasn''t been on the app lately.';
  end if;
  -- One default win per matchup until they challenge back.
  select max(created_at) into v_last_default from public.challenges
   where program_id = v_pid and challenger_id = p_from and opponent_id = p_to and opponent_score = -1;
  if v_last_default is not null and not exists (
    select 1 from public.challenges where program_id = v_pid
       and challenger_id = p_to and opponent_id = p_from and created_at > v_last_default
  ) then
    return 'Waiting for ' || t.name || ' to challenge you back.';
  end if;
  return null;
end;
$function$;

create or replace function public.challenge_opponents()
 returns table(player_id uuid, name text, available boolean, reason text)
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  select p.id, p.name, public._challenge_blocked(auth.uid(), p.id) is null, public._challenge_blocked(auth.uid(), p.id)
    from public.profiles p
    join public.program_members m on m.user_id = p.id and m.program_id = public.ctx_program_id()
   where p.role = 'player' and p.id <> auth.uid()
     and coalesce(m.total_xp, 0) >= public.challenge_xp_threshold()
   order by p.name
$function$;

create or replace function public.send_challenge(p_opponent uuid, p_workout_id uuid, p_score integer DEFAULT NULL::integer, p_tiebreak numeric DEFAULT NULL::numeric, p_rematch_of uuid DEFAULT NULL::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_me uuid := auth.uid();
  v_pid uuid := public.ctx_program_id();
  w public.workouts%rowtype;
  v_blocked text;
  v_attempt uuid;
  v_score numeric;
  v_tb numeric;
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if coalesce(public.member_xp(v_me), 0) < public.challenge_xp_threshold() then
    raise exception 'Challenges unlock at % XP.', public.challenge_xp_threshold() using errcode = '42501';
  end if;
  select * into w from public.workouts where id = p_workout_id and program_id = v_pid;
  if not found or coalesce(w.is_active, true) = false or w.scoring_type not in ('competitive', 'multi_spot') then
    raise exception 'That drill can''t be used for a challenge.';
  end if;
  v_blocked := public._challenge_blocked(v_me, p_opponent);
  if v_blocked is not null then raise exception '%', v_blocked; end if;
  if exists (select 1 from public.challenges where program_id = v_pid and challenger_id = v_me and opponent_id = p_opponent
              and workout_id = p_workout_id and status = 'pending') then
    raise exception 'You already have a challenge waiting with them on this drill.';
  end if;

  if p_score is not null then
    if p_score <= 0 then raise exception 'Please enter a valid score.'; end if;
    perform public.log_workout(p_workout_id, p_score, 0, 0, 0, p_tiebreak, null);
    select id into v_attempt from public.score_attempts
     where player_id = v_me and workout_id = p_workout_id order by attempted_at desc limit 1;
    v_score := p_score;
    v_tb := p_tiebreak;
  else
    select r.attempt_id, r.score, r.tiebreak into v_attempt, v_score, v_tb
      from public.my_recent_challenge_score(p_workout_id) r;
    if v_attempt is null then
      raise exception 'Do the drill and enter a fresh score for this challenge.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.challenges (program_id, challenger_id, challenger_name, opponent_id, opponent_name,
                                 workout_id, workout_title, challenger_score, opponent_score,
                                 challenger_tiebreak, status, opponent_seen, winner_id, challenger_attempt_id)
  values (v_pid, v_me, (select name from public.profiles where id = v_me),
          p_opponent, (select name from public.profiles where id = p_opponent),
          p_workout_id, w.title, null, null, null, 'pending', false, null, v_attempt)
  returning id into v_id;

  insert into public.challenge_pending_scores (program_id, challenge_id, challenger_id, score, tiebreak)
  values (v_pid, v_id, v_me, v_score, v_tb);
  return v_id;
end;
$function$;

create or replace function public.respond_challenge(p_challenge_id uuid, p_score integer, p_tiebreak numeric DEFAULT NULL::numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_me uuid := auth.uid();
  c public.challenges%rowtype;
  w public.workouts%rowtype;
  ps public.challenge_pending_scores%rowtype;
  v_attempt uuid;
  v_winner uuid;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'That challenge no longer exists.'; end if;
  if c.opponent_id <> v_me then raise exception 'Only the challenged player can respond.' using errcode = '42501'; end if;
  if c.program_id is distinct from public.ctx_program_id() then
    raise exception 'Switch to the program this challenge is in to answer it.';
  end if;
  if c.status <> 'pending' then raise exception 'This challenge is already finished.'; end if;
  if coalesce(p_score, 0) < 0 then raise exception 'Please enter a valid score.'; end if;

  select * into ps from public.challenge_pending_scores where challenge_id = c.id;
  select * into w from public.workouts where id = c.workout_id;
  if coalesce(p_score, 0) > 0 then
    perform public.log_workout(c.workout_id, p_score, 0, 0, 0, p_tiebreak, null);
    select id into v_attempt from public.score_attempts
     where player_id = v_me and workout_id = c.workout_id order by attempted_at desc limit 1;
  end if;

  v_winner := public._challenge_winner(w, c.challenger_id, c.opponent_id,
                                       coalesce(ps.score, c.challenger_score, 0), coalesce(p_score, 0),
                                       coalesce(ps.tiebreak, c.challenger_tiebreak), p_tiebreak);
  update public.challenges
     set challenger_score = coalesce(ps.score, challenger_score),
         challenger_tiebreak = coalesce(ps.tiebreak, challenger_tiebreak),
         opponent_score = coalesce(p_score, 0), opponent_tiebreak = p_tiebreak,
         opponent_attempt_id = v_attempt,
         status = 'completed', winner_id = v_winner
   where id = c.id;
  delete from public.challenge_pending_scores where challenge_id = c.id;

  if v_winner is not null then
    insert into public.streak_bonuses (program_id, player_id, points, streak_length, awarded_at, reason, challenge_id)
    values (c.program_id, v_winner, 1, 0, now(), 'challenge_win', c.id)
    on conflict do nothing;
  end if;
  perform public._award_xp(c.challenger_id, '_xp_challenge_sent', 2, 'challenge_sent');
  perform public._award_xp(c.opponent_id, '_xp_challenge_done', 3, 'challenge_done');

  return jsonb_build_object('winner_id', v_winner);
end;
$function$;

-- Nightly: expires every program's stale challenges; each default-win
-- bonus goes to the challenge's own program.
create or replace function public.expire_challenges()
 returns table(challenge_id uuid, challenger_id uuid, opponent_id uuid, workout_title text, challenger_name text, opponent_name text)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
begin
  return query
  with expired as (
    update public.challenges ch
       set status = 'completed', winner_id = ch.challenger_id, opponent_score = -1,
           challenger_score = coalesce((select ps.score from public.challenge_pending_scores ps where ps.challenge_id = ch.id), ch.challenger_score),
           challenger_tiebreak = coalesce((select ps.tiebreak from public.challenge_pending_scores ps where ps.challenge_id = ch.id), ch.challenger_tiebreak)
     where ch.status = 'pending' and ch.created_at < now() - interval '5 days'
       and (auth.uid() is null or ch.program_id = public.ctx_program_id())
    returning ch.id, ch.challenger_id, ch.opponent_id, ch.workout_title, ch.challenger_name, ch.opponent_name, ch.program_id
  ), cleared as (
    delete from public.challenge_pending_scores ps using expired e where ps.challenge_id = e.id
    returning 1
  ), bonus as (
    insert into public.streak_bonuses (program_id, player_id, points, streak_length, awarded_at, reason, challenge_id)
    select e.program_id, e.challenger_id, 1, 0, now(), 'challenge_win', e.id from expired e
    on conflict do nothing
    returning 1
  )
  select e.id, e.challenger_id, e.opponent_id, e.workout_title, e.challenger_name, e.opponent_name from expired e;
end;
$function$;


-- ── 10. Records (Hall of Fame), per program ──────────────────
create or replace function public.upsert_record_unguarded(p_type text, p_workout_id uuid, p_workout_title text, p_workout_desc text, p_player_id uuid, p_player_name text, p_avatar_url text, p_value numeric, p_display_value text, p_season text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid uuid := public.ctx_program_id();
  existing_val numeric;
  is_new_record boolean := false;
begin
  select value into existing_val
    from public.records
   where program_id = v_pid
     and record_type = p_type
     and (workout_id = p_workout_id or (p_workout_id is null and workout_id is null))
   limit 1;

  -- Insert or update if new value is better
  if existing_val is null or p_value > existing_val then
    insert into public.records (
      program_id, record_type, workout_id, workout_title, workout_desc,
      player_id, player_name, avatar_url,
      value, display_value, season, achieved_at, updated_at
    ) values (
      v_pid, p_type, p_workout_id, p_workout_title, p_workout_desc,
      p_player_id, p_player_name, p_avatar_url,
      p_value, p_display_value, p_season, now(), now()
    )
    on conflict (program_id, record_type, workout_id) do update set
      player_id     = excluded.player_id,
      player_name   = excluded.player_name,
      avatar_url    = excluded.avatar_url,
      value         = excluded.value,
      display_value = excluded.display_value,
      season        = excluded.season,
      achieved_at   = excluded.achieved_at,
      updated_at    = now();
    is_new_record := true;
  end if;

  return is_new_record;
end;
$function$;

create or replace function public.refresh_my_records(p_workout_id uuid DEFAULT NULL::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_player uuid := auth.uid();
  v_pid uuid := public.ctx_program_id();
  v_name text;
  v_avatar text;
  v_season text := case when extract(month from public.app_date()) >= 6
                        then extract(year from public.app_date())::int || '-' || (extract(year from public.app_date())::int + 1)
                        else (extract(year from public.app_date())::int - 1) || '-' || extract(year from public.app_date())::int end;
  v_pb numeric;
  w record;
  v_total bigint;
  v_workouts int;
  v_wins int;
  v_played int;
  v_longest int;
begin
  if v_player is null then return; end if;
  select name, avatar_url into v_name, v_avatar from public.profiles where id = v_player;

  if p_workout_id is not null then
    select raw_score into v_pb from public.personal_bests where player_id = v_player and workout_id = p_workout_id;
    select title, description into w from public.workouts where id = p_workout_id and program_id = v_pid;
    if v_pb is not null and w.title is not null then
      perform public.upsert_record_unguarded('best_score', p_workout_id, w.title, coalesce(w.description, ''),
                                   v_player, v_name, v_avatar, v_pb, v_pb::text, v_season);
    end if;
  end if;

  select total into v_total from public.overall_points() where player_id = v_player;
  if v_total is not null then
    perform public.upsert_record_unguarded('most_points_alltime', null, null, null, v_player, v_name, v_avatar,
                                 v_total, v_total || ' pts', v_season);
  end if;

  select count(distinct workout_id) into v_workouts from public.scores where player_id = v_player and program_id = v_pid;
  perform public.upsert_record_unguarded('most_workouts_alltime', null, null, null, v_player, v_name, v_avatar,
                               v_workouts, v_workouts || ' workouts', v_season);

  select count(*) filter (where winner_id = v_player), count(*) into v_wins, v_played
    from public.challenges
   where program_id = v_pid and status = 'completed' and (challenger_id = v_player or opponent_id = v_player);
  if v_wins > 0 then
    perform public.upsert_record_unguarded('most_challenges_won', null, null, null, v_player, v_name, v_avatar,
                                 v_wins, v_wins || ' wins', v_season);
  end if;
  if v_played >= 10 and v_wins > 0 then
    perform public.upsert_record_unguarded('best_win_rate', null, null, null, v_player, v_name, v_avatar,
                                 round(v_wins * 100.0 / v_played),
                                 round(v_wins * 100.0 / v_played) || '% (' || v_wins || '/' || v_played || ')', v_season);
  end if;

  select longest_streak into v_longest from public.streaks where player_id = v_player and program_id = v_pid;
  if coalesce(v_longest, 0) > 0 then
    perform public.upsert_record_unguarded('longest_streak', null, null, null, v_player, v_name, v_avatar,
                                 v_longest, v_longest || ' days', v_season);
  end if;
end;
$function$;


-- ── 11. Teams ─────────────────────────────────────────────────
create or replace function public.increment_team_wins_unguarded(p_player_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
begin
  update public.profiles p
     set team_wins = coalesce(p.team_wins, 0) + 1
   where p.id = any(p_player_ids)
     and exists (select 1 from public.program_members m
                  where m.user_id = p.id and m.program_id = public.ctx_program_id());
end;
$function$;

-- Called by the app when a team competition ends with no teams. Never
-- existed live (see 171).
create or replace function public.close_team_competition(p_competition_id uuid, p_winning_team_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'Only coaches can do that' using errcode = '42501';
  end if;
  update public.team_competitions
     set is_active = false, winning_team_id = p_winning_team_id
   where id = p_competition_id and program_id = public.ctx_program_id();
end;
$function$;
revoke all on function public.close_team_competition(uuid, uuid) from public, anon;
grant execute on function public.close_team_competition(uuid, uuid) to authenticated;


-- ── 12. Inactivity nudges: per program ───────────────────────
-- Now also returns which program each nudge is for, so the nightly job
-- records it there. Server-only, as before.
drop function if exists public.inactivity_nudges_due();
create function public.inactivity_nudges_due()
 returns table(player_id uuid, days_inactive integer, stage integer, nudge_days integer, mode text, program_id uuid)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_all boolean := auth.uid() is null and coalesce(current_setting('ww.program_id', true), '') = '';
  v_list uuid[];
  v_p uuid;
begin
  v_list := case when v_all then array(select id from public.programs order by created_at)
                 else array[public.ctx_program_id()] end;
  foreach v_p in array v_list loop
    if v_all then perform set_config('ww.program_id', v_p::text, true); end if;
    return query
      with cfg as (
        select coalesce((select s.value from public.app_settings s
                          where s.key = 'season_mode' and s.program_id = v_p), 'offseason') as mode
      ), cfg2 as (
        select cfg.mode, case when cfg.mode = 'inseason' then 7 else 14 end as n from cfg
      ), players as (
        select p.id, coalesce(p.last_seen_at, p.created_at) as seen
          from public.profiles p
         where p.role = 'player'
           and exists (select 1 from public.program_members m where m.user_id = p.id and m.program_id = v_p)
           and coalesce(p.grade_category, '') <> 'Alumni'
           and not (p.graduation_year is not null and p.graduation_year < public.current_academic_year())
      ), counted as (
        select pl.id,
               ((now() at time zone public.app_timezone())::date - (pl.seen at time zone public.app_timezone())::date) as d,
               (select count(*) from public.inactivity_nudges n
                 where n.player_id = pl.id and n.program_id = v_p and n.sent_at > pl.seen)::int as sent
          from players pl
      )
      select c.id, c.d, c.sent + 1, (c.sent + 1) * cfg2.n, cfg2.mode, v_p
        from counted c, cfg2
       where (c.sent = 0 and c.d >= cfg2.n)
          or (c.sent = 1 and c.d >= 2 * cfg2.n);
  end loop;
  if v_all then perform set_config('ww.program_id', '', true); end if;
end;
$function$;
revoke all on function public.inactivity_nudges_due() from public, anon, authenticated;


-- ── 13. Leaderboard view: XP from the program membership ─────
create or replace view public.leaderboard with (security_invoker = true) as
 select p.id,
    p.name,
    p."position",
    p.jersey,
    p.grade_category,
    p.avatar_url,
    p.is_period_champion,
    public.member_xp(p.id) as total_xp,
    (coalesce(sum(s.points), (0)::bigint) + coalesce(( select sum(b.points) as sum
           from public.streak_bonuses b
          where (b.player_id = p.id)), (0)::bigint)) as total_points,
    coalesce(sum(s.made), (0)::bigint) as total_made,
    coalesce(sum(s.attempts), (0)::bigint) as total_attempts,
    coalesce(min(s.sprint_secs) filter (where (s.sprint_secs > (0)::numeric)), (0)::numeric) as best_sprint,
    count(distinct s.workout_id) as workouts_completed,
    max(s.logged_at) as last_logged_at,
    coalesce(( select streaks.current_streak
           from public.streaks
          where (streaks.player_id = p.id)), 0) as current_streak,
    rank() over (order by (coalesce(sum(s.points), (0)::bigint) + coalesce(( select sum(b.points) as sum
           from public.streak_bonuses b
          where (b.player_id = p.id)), (0)::bigint)) desc) as rank
   from (public.profiles p
     left join public.scores s on ((s.player_id = p.id)))
  where (p.role = 'player'::text)
  group by p.id, p.name, p."position", p.jersey, p.grade_category, p.avatar_url, p.is_period_champion, p.total_xp;


-- ── 14. Helpers the nightly job and users must not call ──────
revoke all on function public._roll_competitions_one() from public, anon, authenticated;
revoke all on function public._finalize_scoring_windows_one() from public, anon, authenticated;


-- ── 15. AFTER: recompute Boys' numbers and compare ───────────
do $$
declare
  n int;
  v_detail text;
begin
  -- Overall points
  select count(*) into n from (
    (select player_id, total from _b_points
     except select o.player_id, o.total from public.overall_points() o where o.player_id in (select player_id from _b_players))
    union all
    (select o.player_id, o.total from public.overall_points() o where o.player_id in (select player_id from _b_players)
     except select player_id, total from _b_points)) d;
  if n > 0 then raise exception '185 check: Boys overall points changed for % player(s) -- nothing was changed', n; end if;

  -- XP
  select count(*) into n from _b_xp b
   where b.xp is distinct from coalesce((select m.total_xp from public.program_members m
                                          where m.user_id = b.player_id and m.program_id = public.legacy_default_program_id()), 0);
  if n > 0 then raise exception '185 check: Boys XP differs for % player(s) -- nothing was changed', n; end if;

  -- Streaks
  select count(*) into n from (
    (select * from _b_streaks except
     select player_id, current_streak, longest_streak, last_logged_date from public.streaks where program_id = public.legacy_default_program_id())
    union all
    (select player_id, current_streak, longest_streak, last_logged_date from public.streaks where program_id = public.legacy_default_program_id()
     except select * from _b_streaks)) d;
  if n > 0 then raise exception '185 check: Boys streaks changed (% rows) -- nothing was changed', n; end if;

  -- Records
  select count(*) into n from (
    (select * from _b_records except
     select record_type, workout_id, player_id, value from public.records where program_id = public.legacy_default_program_id())
    union all
    (select record_type, workout_id, player_id, value from public.records where program_id = public.legacy_default_program_id()
     except select * from _b_records)) d;
  if n > 0 then raise exception '185 check: Boys records changed (% rows) -- nothing was changed', n; end if;

  -- Current competition and its standings
  if (select count(*) from _b_comp) <> (select count(*) from public.current_competition())
     or exists (select id from _b_comp except select id from public.current_competition()) then
    raise exception '185 check: Boys current competition changed -- nothing was changed';
  end if;
  select count(*) into n from (
    (select * from _b_standings except
     select s.player_id, s.points from _b_comp c, public.competition_standings(c.id) s where s.player_id in (select player_id from _b_players))
    union all
    (select s.player_id, s.points from _b_comp c, public.competition_standings(c.id) s where s.player_id in (select player_id from _b_players)
     except select * from _b_standings)) d;
  if n > 0 then raise exception '185 check: Boys competition standings changed (% rows) -- nothing was changed', n; end if;

  -- Live window points
  select count(*) into n from (
    (select * from _b_live except
     select wp.player_id, wp.workout_id, wp.points, wp.source
       from public.live_window() lw, public.window_points(lw.starts_at, lw.ends_at, lw.with_placings) wp
      where wp.player_id in (select player_id from _b_players))
    union all
    (select wp.player_id, wp.workout_id, wp.points, wp.source
       from public.live_window() lw, public.window_points(lw.starts_at, lw.ends_at, lw.with_placings) wp
      where wp.player_id in (select player_id from _b_players)
     except select * from _b_live)) d;
  if n > 0 then raise exception '185 check: Boys live points changed (% rows) -- nothing was changed', n; end if;

  -- Every player's breakdown
  select count(*) into n from (
    (select * from _b_breakdown except
     select b.player_id, x.label, x.competition_id, x.points, x.won from _b_players b, lateral public.overall_breakdown(b.player_id) x)
    union all
    (select b.player_id, x.label, x.competition_id, x.points, x.won from _b_players b, lateral public.overall_breakdown(b.player_id) x
     except select * from _b_breakdown)) d;
  if n > 0 then raise exception '185 check: Boys points breakdowns changed (% rows) -- nothing was changed', n; end if;
end $$;

commit;


-- ── Check ─────────────────────────────────────────────────────
-- If you're seeing this, Boys' numbers were recomputed with the new
-- functions and matched exactly. One row per program:
--   players / with_xp / streaks / records / competitions / badges /
--   fenced (24 for every row).
-- Girls: badges = Boys' count; everything else 0 (or tiny if a Girls
-- test account has logged anything).
select pr.name as program,
       (select count(*) from public.program_members m join public.profiles p on p.id = m.user_id
         where m.program_id = pr.id and p.role = 'player') as players,
       (select count(*) from public.program_members m where m.program_id = pr.id and m.total_xp > 0) as with_xp,
       (select count(*) from public.streaks s where s.program_id = pr.id) as streaks,
       (select count(*) from public.records r where r.program_id = pr.id) as records,
       (select count(*) from public.competitions c where c.program_id = pr.id) as competitions,
       (select count(*) from public.badges b where b.program_id = pr.id) as badges,
       (select count(*) from pg_policy pol where pol.polname = 'program_scope'
          and pol.polrelid::regclass::text in ('scores','score_attempts','personal_bests','spot_personal_bests','streaks',
            'streak_bonuses','points_ledger','scoring_windows','xp_log','perk_usage','perk_boosts','competitions',
            'biweekly_champions','period_snapshots','records','badges','season_history','inseason_history','challenges',
            'challenge_pending_scores','class_clash_competitions','team_competitions','teams','inactivity_nudges')) as fenced,
       case when pr.id = public.legacy_default_program_id()
            then (select count(*) from _b_players)::text || ' players checked: identical'
            else '' end as boys_before_after
  from public.programs pr
 order by pr.name;
