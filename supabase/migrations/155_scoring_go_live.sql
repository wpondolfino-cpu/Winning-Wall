-- 155_scoring_go_live.sql
--
-- Option B, Phase 1b: GO-LIVE. Run this right after the 1b app files are
-- live on Vercel (same sitting).
--
--   1. overall_breakdown(): a player's overall points by competition
--   2. refresh_my_records(): Hall of Fame records worked out on the server
--   3. restart_scoring_season(): Reset & Archive starts points from zero
--   4. GO-LIVE: each player's current overall total becomes their
--      starting balance, and the new scoring starts counting now.

-- ══ 1. Overall, by competition ═══════════════════════════════════
-- One row per stretch of time since go-live: the starting balance, each
-- totalled competition or pause, and the one running now. Each row holds
-- everything earned in it: placings, self-reported, flat points, bonuses.
create or replace function public.overall_breakdown(p_player uuid)
returns table (label text, competition_id uuid, starts_at timestamptz, ends_at timestamptz,
               points bigint, running boolean, won boolean)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_started timestamptz := public.scoring_started_at();
begin
  if v_started is null then return; end if;
  perform public.finalize_scoring_windows();
  return query
    with windows as (
      select sw.starts_at as s, sw.ends_at as e, sw.competition_id as cid, false as live
        from public.scoring_windows sw
      union all
      select lw.starts_at, lw.ends_at, lw.competition_id, true from public.live_window() lw
    ),
    per as (
      select w.s, w.e, w.cid, w.live,
             coalesce((select sum(l.points) from public.points_ledger l
                        where l.player_id = p_player and l.source in ('placing', 'self_reported')
                          and l.window_start = w.s and l.window_end = w.e and not w.live), 0)
           + coalesce((select sum(wp.points) from public.window_points(w.s, w.e, w.cid is not null) wp
                        where w.live and wp.player_id = p_player), 0)
           + coalesce((select sum(l.points) from public.points_ledger l
                        where l.player_id = p_player and l.source = 'flat'
                          and l.earned_at >= w.s and l.earned_at < w.e), 0)
           + coalesce((select sum(b.points) from public.streak_bonuses b
                        where b.player_id = p_player and b.awarded_at >= greatest(w.s, v_started) and b.awarded_at < w.e), 0)
             as pts
        from windows w
    )
    select 'Before competitions began'::text, null::uuid, null::timestamptz, v_started,
           coalesce(sum(l.points), 0)::bigint, false, false
      from public.points_ledger l
     where l.player_id = p_player and l.source = 'baseline'
    having coalesce(sum(l.points), 0) <> 0
    union all
    select coalesce(c.name, 'Between competitions'), per.cid, per.s, per.e, per.pts::bigint, per.live,
           exists (select 1 from public.biweekly_champions bc where bc.competition_id = per.cid and bc.player_id = p_player)
      from per left join public.competitions c on c.id = per.cid
     where per.pts <> 0 or per.cid is not null
     order by 3 nulls first;
end;
$$;

-- ══ 2. Hall of Fame records, from the server's own numbers ═══════
-- Reads everything itself -- the caller can't pass a value in -- so it's
-- safe for the app to call after a log.
create or replace function public.refresh_my_records(p_workout_id uuid default null)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_player uuid := auth.uid();
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
    select title, description into w from public.workouts where id = p_workout_id;
    if v_pb is not null and w.title is not null then
      perform public.upsert_record('best_score', p_workout_id, w.title, coalesce(w.description, ''),
                                   v_player, v_name, v_avatar, v_pb, v_pb::text, v_season);
    end if;
  end if;

  select total into v_total from public.overall_points() where player_id = v_player;
  if v_total is not null then
    perform public.upsert_record('most_points_alltime', null, null, null, v_player, v_name, v_avatar,
                                 v_total, v_total || ' pts', v_season);
  end if;

  select count(distinct workout_id) into v_workouts from public.scores where player_id = v_player;
  perform public.upsert_record('most_workouts_alltime', null, null, null, v_player, v_name, v_avatar,
                               v_workouts, v_workouts || ' workouts', v_season);

  select count(*) filter (where winner_id = v_player), count(*) into v_wins, v_played
    from public.challenges
   where status = 'completed' and (challenger_id = v_player or opponent_id = v_player);
  if v_wins > 0 then
    perform public.upsert_record('most_challenges_won', null, null, null, v_player, v_name, v_avatar,
                                 v_wins, v_wins || ' wins', v_season);
  end if;
  if v_played >= 10 and v_wins > 0 then
    perform public.upsert_record('best_win_rate', null, null, null, v_player, v_name, v_avatar,
                                 round(v_wins * 100.0 / v_played),
                                 round(v_wins * 100.0 / v_played) || '% (' || v_wins || '/' || v_played || ')', v_season);
  end if;

  select longest_streak into v_longest from public.streaks where player_id = v_player;
  if coalesce(v_longest, 0) > 0 then
    perform public.upsert_record('longest_streak', null, null, null, v_player, v_name, v_avatar,
                                 v_longest, v_longest || ' days', v_season);
  end if;
end;
$$;

-- ══ 3. A new season's points start from zero ═════════════════════
-- Called by Reset & Archive after both archives are written and live
-- data is cleared.
create or replace function public.restart_scoring_season()
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'Only coaches can do that' using errcode = '42501';
  end if;
  delete from public.points_ledger where true;
  delete from public.scoring_windows where true;
  insert into public.app_settings (key, value) values ('scoring_started_at', now()::text)
  on conflict (key) do update set value = excluded.value;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('overall_breakdown', 'refresh_my_records', 'restart_scoring_season')
  loop
    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
  end loop;
end $$;

-- ══ 4. GO-LIVE ═══════════════════════════════════════════════════
-- Starting balance = each player's overall total right now, exactly as
-- the leaderboard shows it (drill points + every bonus). Runs once: if
-- the new scoring has already started, this does nothing.
do $$
begin
  if public.scoring_started_at() is not null then
    raise notice 'Scoring already live -- go-live skipped';
    return;
  end if;

  insert into public.points_ledger (player_id, points, source, earned_at)
  select lb.id, lb.total_points, 'baseline', now()
    from public.leaderboard lb
   where coalesce(lb.total_points, 0) <> 0;

  insert into public.app_settings (key, value) values ('scoring_started_at', now()::text)
  on conflict (key) do update set value = excluded.value;
end $$;

-- ══ Check it ═════════════════════════════════════════════════════
-- Right after go-live these two should match for every player:
--
--   select p.name, lb.total_points as old_total, op.total as new_total
--     from public.overall_points() op
--     join public.profiles p on p.id = op.player_id
--     left join public.leaderboard lb on lb.id = op.player_id
--    where coalesce(lb.total_points, 0) <> op.total;
--
-- Expect: no rows, or only players who logged a workout in the minutes
-- since running this (their new points counting the new way).
