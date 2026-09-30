-- 158_perks_server.sql
--
-- Option B, Phase 3: the two perks run on the server, and the last two
-- scoring tables are locked. This completes Option B.
--
--   * Streak Shield: covers ONE missed day. Used the day after a miss, it
--     keeps the streak alive (as if yesterday was logged) so logging today
--     continues it. It no longer adds a free day, and it isn't used up if
--     the streak doesn't need saving.
--   * Score Boost: +5 on one drill for the running competition -- added to
--     that player's best result on it in this competition, so it counts
--     toward placings. (Since competitions went window-based in Phase 1,
--     the old boost edited a number standings no longer read.)
--   * Both: once per competition, only while one is running, only once
--     unlocked by XP.
--   * Locks: scores, streaks and perk_usage -- server and coaches only.

-- ══ 1. Boosts ════════════════════════════════════════════════════
create table if not exists public.perk_boosts (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles(id) on delete cascade,
  workout_id     uuid not null references public.workouts(id) on delete cascade,
  competition_id uuid references public.competitions(id) on delete set null,
  points         integer not null default 5,
  used_at        timestamptz not null default now()
);
create index if not exists perk_boosts_lookup_idx on public.perk_boosts(workout_id, player_id, used_at);
alter table public.perk_boosts enable row level security;
drop policy if exists "perk_boosts_read" on public.perk_boosts;
create policy "perk_boosts_read" on public.perk_boosts for select using (auth.uid() is not null);

-- Competition placings now include boosts.
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
$$;

-- ══ 2. Shared checks ═════════════════════════════════════════════
-- The running competition and the key perk uses are recorded under
-- (its start date, as the app has always used).
create or replace function public._perk_ready(p_perk text)
returns table (competition_id uuid, period_key date)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := auth.uid();
  c record;
  v_needed int;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select id, starts_at into c from public.competitions where starts_at <= now() and ends_at > now() limit 1;
  if not found then raise exception 'No competition is running right now.'; end if;
  select xp_required into v_needed from public.xp_settings where perk_key = p_perk;
  if v_needed is not null and coalesce((select total_xp from public.profiles where id = v_me), 0) < v_needed then
    raise exception 'You unlock this perk at % XP.', v_needed using errcode = '42501';
  end if;
  if exists (select 1 from public.perk_usage where player_id = v_me and perk_key = p_perk
              and period_start = (c.starts_at at time zone 'UTC')::date) then
    raise exception 'Already used this competition.';
  end if;
  return query select c.id, (c.starts_at at time zone 'UTC')::date;
end;
$$;

-- ══ 3. Streak Shield ═════════════════════════════════════════════
create or replace function public.use_streak_shield()
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := auth.uid();
  v_today date := public.app_date();
  r record;
  s public.streaks%rowtype;
begin
  select * into r from public._perk_ready('streak_shield');
  select * into s from public.streaks where player_id = v_me;
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
  update public.streaks set last_logged_date = v_today - 1 where player_id = v_me;
  insert into public.perk_usage (player_id, perk_key, period_start) values (v_me, 'streak_shield', r.period_key);
  return jsonb_build_object('streak', s.current_streak);
end;
$$;

-- ══ 4. Score Boost ═══════════════════════════════════════════════
create or replace function public.use_score_boost(p_workout_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := auth.uid();
  r record;
  c record;
  w public.workouts%rowtype;
begin
  select * into r from public._perk_ready('score_boost');
  select starts_at, ends_at into c from public.competitions where id = r.competition_id;
  select * into w from public.workouts where id = p_workout_id;
  if not found or w.scoring_type not in ('competitive', 'multi_spot') then
    raise exception 'Score Boost works on ranked drills only.';
  end if;
  if not exists (select 1 from public.score_attempts where player_id = v_me and workout_id = p_workout_id
                  and attempted_at >= c.starts_at and attempted_at < c.ends_at) then
    raise exception 'Log % in this competition first, then boost it.', w.title;
  end if;
  insert into public.perk_boosts (player_id, workout_id, competition_id, points) values (v_me, p_workout_id, r.competition_id, 5);
  insert into public.perk_usage (player_id, perk_key, period_start) values (v_me, 'score_boost', r.period_key);
  return jsonb_build_object('workout', w.title, 'points', 5);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('use_streak_shield', 'use_score_boost')
  loop
    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
  end loop;
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '_perk_ready'
  loop
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.proname, r.args);
  end loop;
end $$;

-- ══ 5. Locks ═════════════════════════════════════════════════════
-- Every write policy players had on these goes; coaches keep full access.
-- perk_usage's old rule was "for all" (read and write), so players get
-- their own read back explicitly.
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['scores', 'streaks', 'perk_usage', 'perk_boosts'] loop
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT'
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('drop policy if exists "staff_write" on public.%I', t);
    execute format('create policy "staff_write" on public.%I for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()))', t);
  end loop;
end $$;

drop policy if exists "perk_usage_read_own" on public.perk_usage;
create policy "perk_usage_read_own" on public.perk_usage for select using (player_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['scores', 'streaks'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd = 'SELECT') then
      execute format('create policy "signed_in_read" on public.%I for select using (auth.uid() is not null)', t);
    end if;
  end loop;
end $$;

-- ══ Check it ═════════════════════════════════════════════════════
-- No player write rules left anywhere in scoring:
--
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('scores','score_attempts','personal_bests','spot_personal_bests',
--                        'streaks','streak_bonuses','xp_log','challenges','perk_usage','perk_boosts',
--                        'library_practice_log','points_ledger')
--      and cmd <> 'SELECT'
--    order by 1;
--
-- Expect only "staff_write" rows.
