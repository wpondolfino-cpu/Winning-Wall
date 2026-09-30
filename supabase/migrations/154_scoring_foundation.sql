-- 154_scoring_foundation.sql
--
-- Option B, Phase 1a: the server-side scoring foundation.
--
-- ADDITIVE ONLY. The app keeps working exactly as it does now: nothing
-- here is called by the current app, and no existing table changes
-- except that competitions/reminders/nudges now read the timezone from a
-- setting (still Eastern, so nothing moves).
--
--   1. Program timezone setting (app_settings 'timezone')
--   2. Points record (points_ledger) and finished-window tracking
--   3. Competition placings from results logged INSIDE its dates
--   4. Overall totals = starting balance + every finished window + the
--      live window + bonuses since go-live
--   5. log_workout() / log_library_practice() -- every scoring rule in
--      one step
--   6. claim_daily_completion()
--
-- Phase 1b switches the app to these and freezes starting balances.
-- Phase 1c locks the tables.

-- ══ 1. Timezone ══════════════════════════════════════════════════
insert into public.app_settings (key, value) values ('timezone', 'America/New_York')
on conflict (key) do nothing;

create or replace function public.app_timezone()
returns text
language sql stable security definer
set search_path = public, extensions
as $$ select coalesce((select value from public.app_settings where key = 'timezone'), 'America/New_York') $$;

-- The program's calendar date for a moment (default: now).
create or replace function public.app_date(ts timestamptz default now())
returns date
language sql stable
as $$ select (ts at time zone public.app_timezone())::date $$;

-- Everything that assumed Eastern now reads the setting.
create or replace function public.competition_midnight(d date)
returns timestamptz
language sql stable
as $$ select d::timestamp at time zone public.app_timezone() $$;

create or replace function public.competition_default_name(s timestamptz, e timestamptz)
returns text
language sql stable
as $$
  select case
    when (s at time zone public.app_timezone())::date = ((e at time zone public.app_timezone()) - interval '1 second')::date
      then to_char(s at time zone public.app_timezone(), 'Mon FMDD')
    else to_char(s at time zone public.app_timezone(), 'Mon FMDD') || ' – ' ||
         to_char((e at time zone public.app_timezone()) - interval '1 second', 'Mon FMDD')
  end
$$;

create or replace function public.roll_competitions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  last   public.competitions%rowtype;
  s      timestamptz;
  e      timestamptz;
  made   int := 0;
begin
  loop
    select * into last from public.competitions order by ends_at desc limit 1;
    exit when not found or not last.repeats or last.ends_at > now() or made >= 100;

    s := last.ends_at;
    -- Lengths are added in Eastern local time, so a boundary stays at
    -- midnight across a daylight-saving change.
    e := case last.length_kind
      when 'day'       then ((s at time zone public.app_timezone()) + interval '1 day')   at time zone public.app_timezone()
      when 'week'      then ((s at time zone public.app_timezone()) + interval '7 days')  at time zone public.app_timezone()
      when 'two_weeks' then ((s at time zone public.app_timezone()) + interval '14 days') at time zone public.app_timezone()
      when 'month'     then ((s at time zone public.app_timezone()) + interval '1 month') at time zone public.app_timezone()
      else s + (last.ends_at - last.starts_at)
    end;

    insert into public.competitions (name, starts_at, ends_at, length_kind, repeats, created_by)
    values (public.competition_default_name(s, e), s, e, last.length_kind, true, last.created_by);
    made := made + 1;
  end loop;
  return made;
end;
$$;

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
           ((now() at time zone public.app_timezone())::date - (pl.seen at time zone public.app_timezone())::date) as d,
           (select count(*) from public.inactivity_nudges n where n.player_id = pl.id and n.sent_at > pl.seen)::int as sent
      from players pl
  )
  select c.id, c.d, c.sent + 1, (c.sent + 1) * cfg2.n, cfg2.mode
    from counted c, cfg2
   where (c.sent = 0 and c.d >= cfg2.n)
      or (c.sent = 1 and c.d >= 2 * cfg2.n)
$$;

-- ══ 2. Results, direction ════════════════════════════════════════
-- Same raw-score rule as the app and rerank_workout: typed points win;
-- a pure time counts negative (so bigger is better); else made + reps.
create or replace function public.raw_result(p_made numeric, p_reps numeric, p_sprint numeric, p_self numeric)
returns numeric
language sql immutable
as $$
  select case
    when coalesce(p_self, 0) > 0 then p_self
    when coalesce(p_sprint, 0) > 0 and coalesce(p_made, 0) = 0 and coalesce(p_reps, 0) = 0 then -p_sprint
    else coalesce(p_made, 0) + coalesce(p_reps, 0)
  end
$$;

-- ══ 3. The points record ═════════════════════════════════════════
create table if not exists public.points_ledger (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles(id) on delete cascade,
  points         integer not null,
  source         text not null check (source in ('baseline', 'placing', 'self_reported', 'flat')),
  workout_id     uuid references public.workouts(id) on delete set null,
  competition_id uuid references public.competitions(id) on delete set null,
  window_start   timestamptz,
  window_end     timestamptz,
  earned_at      timestamptz not null default now()
);
create index if not exists points_ledger_player_idx on public.points_ledger(player_id);
create index if not exists points_ledger_flat_idx on public.points_ledger(player_id, workout_id, earned_at) where source = 'flat';

alter table public.points_ledger enable row level security;
drop policy if exists "points_ledger_read" on public.points_ledger;
create policy "points_ledger_read" on public.points_ledger for select using (auth.uid() is not null);
-- No write policies: only the scoring functions write.

-- Which windows (competitions, and the gaps between them) are totalled.
create table if not exists public.scoring_windows (
  id             uuid primary key default gen_random_uuid(),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  competition_id uuid references public.competitions(id) on delete set null,
  finalized_at   timestamptz not null default now(),
  unique (starts_at, ends_at)
);
alter table public.scoring_windows enable row level security;
drop policy if exists "scoring_windows_read" on public.scoring_windows;
create policy "scoring_windows_read" on public.scoring_windows for select using (auth.uid() is not null);

create index if not exists score_attempts_window_idx on public.score_attempts(attempted_at, workout_id);

-- ══ 4. Points earned inside one window ═══════════════════════════
-- Competitive / multi-spot (when p_with_placings): each player's best
-- result logged in the window, on the drill's current run, ranked within
-- grade group, same place points and tiebreaks as rerank_workout.
-- Self-reported: the latest entry in the window.
-- Only drills that are live (active, and in an active group or none).
create or replace function public.window_points(p_start timestamptz, p_end timestamptz, p_with_placings boolean)
returns table (player_id uuid, workout_id uuid, points integer, source text, best_raw numeric, place integer)
language sql stable security definer
set search_path = public, extensions
as $$
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
     where coalesce(wk.is_active, true) and (g.id is null or g.status = 'active')
  ),
  att as (
    select a.player_id, a.workout_id, a.attempted_at, a.tiebreak_value, a.self_points,
           coalesce(a.run, 1) as run,
           public.raw_result(a.made, a.reps, a.sprint_secs, a.self_points) as raw
      from public.score_attempts a
     where a.attempted_at >= p_start and a.attempted_at < p_end
  ),
  best as (
    select distinct on (att.player_id, att.workout_id)
           att.player_id, att.workout_id, att.raw, att.tiebreak_value, w.dir, w.tie_dir, w.p1, w.p2, w.p3
      from att join w on w.id = att.workout_id
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
$$;

-- Standings for one competition: placings + self-reported + bonuses
-- earned inside it. What the Current tab and crowning will use.
create or replace function public.competition_standings(p_competition_id uuid)
returns table (player_id uuid, points bigint)
language sql stable security definer
set search_path = public, extensions
as $$
  with c as (select starts_at, ends_at from public.competitions where id = p_competition_id),
  pts as (
    select wp.player_id, wp.points::bigint as points from c, public.window_points(c.starts_at, c.ends_at, true) wp
    union all
    select b.player_id, b.points::bigint from public.streak_bonuses b, c
     where b.awarded_at >= c.starts_at and b.awarded_at < c.ends_at
  )
  select player_id, sum(points) from pts group by player_id
$$;

-- ══ 5. Totalling finished windows ════════════════════════════════
-- Nothing counts until go-live sets app_settings 'scoring_started_at'
-- (Phase 1b). From then: every competition that ends is totalled with
-- placings; every gap between competitions (a pause) is totalled for
-- self-reported drills only. A competition already running at go-live
-- only counts results logged after go-live -- earlier ones are in the
-- starting balance.
create or replace function public.scoring_started_at()
returns timestamptz
language sql stable security definer
set search_path = public, extensions
as $$ select (select value from public.app_settings where key = 'scoring_started_at')::timestamptz $$;

create or replace function public.finalize_window(p_start timestamptz, p_end timestamptz, p_competition_id uuid, p_with_placings boolean)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if p_end <= p_start then return; end if;
  insert into public.scoring_windows (starts_at, ends_at, competition_id)
  values (p_start, p_end, p_competition_id)
  on conflict (starts_at, ends_at) do nothing;
  if not found then return; end if;  -- already totalled
  insert into public.points_ledger (player_id, points, source, workout_id, competition_id, window_start, window_end, earned_at)
  select wp.player_id, wp.points, wp.source, wp.workout_id, p_competition_id, p_start, p_end, p_end
    from public.window_points(p_start, p_end, p_with_placings) wp
   where wp.points > 0;
end;
$$;

create or replace function public.finalize_scoring_windows()
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_started timestamptz := public.scoring_started_at();
  v_cursor  timestamptz;
  c record;
begin
  if v_started is null then return; end if;
  v_cursor := v_started;
  for c in
    select id, starts_at, ends_at from public.competitions
     where ends_at > v_started order by starts_at
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
$$;

-- The window open right now: the running competition, or the pause.
create or replace function public.live_window()
returns table (starts_at timestamptz, ends_at timestamptz, competition_id uuid, with_placings boolean)
language sql stable security definer
set search_path = public, extensions
as $$
  with v as (select public.scoring_started_at() as started),
  cur as (
    select c.id, c.starts_at, c.ends_at from public.competitions c
     where c.starts_at <= now() and c.ends_at > now() limit 1
  )
  select greatest(cur.starts_at, v.started), cur.ends_at, cur.id, true from cur, v
   where v.started is not null
  union all
  select greatest(v.started, coalesce((select max(c.ends_at) from public.competitions c where c.ends_at <= now()), v.started)),
         now(), null::uuid, false
    from v
   where v.started is not null and not exists (select 1 from cur)
$$;

-- Overall = starting balance and finished windows (the ledger) + the live
-- window + bonuses since go-live. Totals finished windows first.
create or replace function public.overall_points()
returns table (player_id uuid, total bigint)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_started timestamptz := public.scoring_started_at();
begin
  if v_started is null then return; end if;
  perform public.finalize_scoring_windows();
  return query
    with pts as (
      select l.player_id, l.points::bigint as points from public.points_ledger l
      union all
      select b.player_id, b.points::bigint from public.streak_bonuses b where b.awarded_at >= v_started
      union all
      select wp.player_id, wp.points::bigint
        from public.live_window() lw, public.window_points(lw.starts_at, lw.ends_at, lw.with_placings) wp
    )
    select p.id, coalesce(sum(pts.points), 0)::bigint
      from public.profiles p left join pts on pts.player_id = p.id
     where p.role = 'player'
     group by p.id;
end;
$$;

-- ══ 6. Logging ═══════════════════════════════════════════════════
-- Shared: streak update (days in the program timezone; +3 every 7 in a
-- row, once a day), XP (first 3 logs of a drill per day, any source).
create or replace function public._scoring_streak(p_player uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_today date := public.app_date();
  s public.streaks%rowtype;
  v_new int := 1;
  v_bonus boolean := false;
begin
  select * into s from public.streaks where player_id = p_player;
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
    insert into public.streak_bonuses (player_id, points, streak_length, awarded_at, reason)
    values (p_player, 3, v_new, now(), 'streak');
  end if;
  insert into public.streaks (player_id, current_streak, longest_streak, last_logged_date, bonus_awarded_at)
  values (p_player, v_new, v_new, v_today, case when v_bonus then v_today end)
  on conflict (player_id) do update set
    current_streak   = excluded.current_streak,
    longest_streak   = greatest(public.streaks.longest_streak, excluded.current_streak),
    last_logged_date = excluded.last_logged_date,
    bonus_awarded_at = case when v_bonus then v_today else public.streaks.bonus_awarded_at end;
  return jsonb_build_object('streak', v_new, 'streak_bonus', v_bonus);
end;
$$;

create or replace function public._scoring_xp(p_player uuid, p_workout uuid, p_reason text)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_today_count int;
  v_amount int;
begin
  -- Counted after this log's entry is written, so <= 3 means first three.
  select count(*) into v_today_count from public.score_attempts
   where player_id = p_player and workout_id = p_workout and public.app_date(attempted_at) = public.app_date();
  if v_today_count > 3 then return 0; end if;
  select coalesce((select xp_required from public.xp_settings where perk_key = '_xp_workout'), 10) into v_amount;
  insert into public.xp_log (player_id, xp_amount, reason) values (p_player, v_amount, p_reason);
  update public.profiles set total_xp = coalesce(total_xp, 0) + v_amount where id = p_player;
  return v_amount;
end;
$$;

-- All-time personal best (survives resets). Returns the previous best,
-- whether this is a new one, and who held #1 if this took it from them.
create or replace function public._scoring_personal_best(p_player uuid, p_workout uuid, p_raw numeric, p_dir int)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_prev numeric;
  v_top record;
  v_new boolean;
  v_overtaken uuid;
begin
  select raw_score into v_prev from public.personal_bests where player_id = p_player and workout_id = p_workout;
  v_new := v_prev is null or p_raw * p_dir > v_prev * p_dir;
  if v_new then
    select player_id, raw_score into v_top from public.personal_bests
     where workout_id = p_workout and player_id <> p_player
     order by raw_score * p_dir desc limit 1;
    insert into public.personal_bests (player_id, workout_id, raw_score, achieved_at)
    values (p_player, p_workout, p_raw, now())
    on conflict (player_id, workout_id) do update set raw_score = excluded.raw_score, achieved_at = excluded.achieved_at;
    if v_top.player_id is not null and p_raw * p_dir > v_top.raw_score * p_dir
       and (v_prev is null or v_prev * p_dir <= v_top.raw_score * p_dir) then
      v_overtaken := v_top.player_id;
    end if;
  end if;
  return jsonb_build_object('is_personal_best', v_new, 'previous_best', v_prev, 'overtaken_player', v_overtaken);
end;
$$;

-- Impossible values only; big jumps are confirmed in the app instead.
create or replace function public._scoring_check(p_made numeric, p_reps numeric, p_sprint numeric, p_self numeric, p_allow_negative boolean)
returns void
language plpgsql immutable
as $$
begin
  if not coalesce(p_allow_negative, false)
     and (coalesce(p_made, 0) < 0 or coalesce(p_reps, 0) < 0 or coalesce(p_self, 0) < 0) then
    raise exception 'Scores can''t be negative for this drill.' using errcode = '22023';
  end if;
  if coalesce(p_sprint, 0) < 0 then
    raise exception 'A time can''t be negative.' using errcode = '22023';
  end if;
  if abs(coalesce(p_made, 0)) > 9999 or abs(coalesce(p_reps, 0)) > 9999
     or abs(coalesce(p_self, 0)) > 9999 or coalesce(p_sprint, 0) > 9999 then
    raise exception 'That number is too large — check it and try again.' using errcode = '22023';
  end if;
  if coalesce(p_sprint, 0) > 0 and p_sprint < 1 then
    raise exception 'A time under 1 second isn''t possible — check it and try again.' using errcode = '22023';
  end if;
end;
$$;

-- ── Logging a workout (an active drill) ─────────────────────────
create or replace function public.log_workout(
  p_workout_id     uuid,
  p_made           integer default 0,
  p_reps           integer default 0,
  p_sprint_secs    numeric default 0,
  p_self_points    integer default 0,
  p_tiebreak_value numeric default null,
  p_spot_scores    numeric[] default null
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
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
$$;

-- ── Logging a Drill Library practice (an inactive drill) ────────
create or replace function public.log_library_practice(
  p_workout_id  uuid,
  p_made        integer default 0,
  p_reps        integer default 0,
  p_sprint_secs numeric default 0,
  p_self_points integer default 0
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
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
$$;

-- ── +1 for logging every ranked drill today ─────────────────────
-- Same set as the Workouts page: live, published drills; if they all
-- share one group name, that group only; competitive / multi-spot with
-- the leaderboard on. Once a day.
create or replace function public.claim_daily_completion()
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_player uuid := auth.uid();
  v_today date := public.app_date();
  v_total int;
  v_done int;
  v_group text;
  v_groups int;
begin
  if v_player is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select count(distinct group_name), min(group_name) into v_groups, v_group
    from public.workouts
   where coalesce(is_active, true) and (publish_date is null or publish_date <= v_today) and group_name is not null;

  with ranked as (
    select id from public.workouts
     where coalesce(is_active, true) and (publish_date is null or publish_date <= v_today)
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
     where player_id = v_player and reason = 'daily_completion' and public.app_date(awarded_at) = v_today
  ) then
    insert into public.streak_bonuses (player_id, points, streak_length, awarded_at, reason)
    values (v_player, 1, 0, now(), 'daily_completion');
    return jsonb_build_object('completed', v_done, 'total', v_total, 'awarded', true);
  end if;
  return jsonb_build_object('completed', v_done, 'total', v_total, 'awarded', false);
end;
$$;

-- ══ Who can call what ════════════════════════════════════════════
-- Signed-in users: logging, standings, totals. Internals: nobody but the
-- functions themselves.
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'log_workout', 'log_library_practice', 'claim_daily_completion',
       'competition_standings', 'overall_points', 'finalize_scoring_windows', 'window_points', 'live_window')
  loop
    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
  end loop;
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       '_scoring_streak', '_scoring_xp', '_scoring_personal_best', 'finalize_window')
  loop
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.proname, r.args);
  end loop;
end $$;
