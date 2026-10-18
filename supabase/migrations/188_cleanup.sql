-- ============================================================
-- 188_cleanup.sql
--
-- MULTI-TENANCY STEP 11 — cleanup.
--
-- 1. Hall of Fame records rebuilt. Records couldn't save before 185
--    (two clashing rules on the table), so they've been empty. This
--    fills each program's records from what's already there: best score
--    per drill, most points, most drills, most H2H wins, best H2H win
--    rate (10+ played) and longest streak. Test accounts are left out.
--    Only fills records that don't exist yet.
--    Also: "best score" on a lower-is-better drill now keeps the LOWEST
--    score as the record (it kept the highest).
-- 2. No more Boys fallback. Until now, anything saved without a program
--    landed in Boys. Now it's refused with "Pick a program first" --
--    with 12 schools, a silent wrong-program save is worse than an
--    error. Everyone in a program already has one selected (checked
--    below; any member without one is set to their program first).
-- 3. send_welcome_email dropped -- made in the dashboard, never called by
--    the app, already locked in 150 (noted in 171).
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Anyone in a program has one selected ──────────────────
update public.profiles p
   set active_program_id = (select m.program_id from public.program_members m
                             where m.user_id = p.id order by m.created_at limit 1)
 where p.active_program_id is null
   and exists (select 1 from public.program_members m where m.user_id = p.id);


-- ── 2. No Boys fallback ───────────────────────────────────────
-- Signed-in person: the program they're in. Server job: the program it
-- is working on. Neither -> no program (saves are refused).
create or replace function public.ctx_program_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when auth.uid() is null then nullif(current_setting('ww.program_id', true), '')::uuid
    else public.current_program_id()
  end
$$;

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
  if new.program_id is null then
    raise exception 'Pick a program first (no program selected for this save).' using errcode = '23502';
  end if;
  return new;
end
$$;

create or replace function public.current_academic_year()
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select extract(year from start_date)::int + 1
       from public.seasons
      where is_current and start_date is not null
        and program_id = public.ctx_program_id()
      limit 1),
    case when extract(month from current_date) >= 8
      then extract(year from current_date)::int + 1
      else extract(year from current_date)::int end
  );
$function$;

create or replace function public.saved_groupings_set_season()
 returns trigger
 language plpgsql
as $function$
declare v_pid uuid := coalesce(new.program_id, public.ctx_program_id());
begin
  if new.season_id is null then
    new.season_id := coalesce(
      (select id from public.seasons where is_current and program_id = v_pid limit 1),
      (select id from public.seasons where program_id = v_pid and start_date is not null
         and start_date <= current_date order by start_date desc limit 1)
    );
  end if;
  return new;
end;
$function$;

create or replace function public.week_for_date(p_date date, p_season_id uuid DEFAULT NULL::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid   uuid := public.ctx_program_id();
  v_id    uuid;
  v_start date;
  v_end   date;
begin
  if v_pid is null then raise exception 'Pick a program first.'; end if;
  select id into v_id from public.practice_weeks
   where program_id = v_pid
     and start_date is not null and end_date is not null
     and p_date between start_date and end_date
   order by start_date desc limit 1;
  if v_id is not null then return v_id; end if;

  v_start := p_date - extract(dow from p_date)::int;
  v_end   := v_start + 6;

  insert into public.practice_weeks (program_id, name, season_id, start_date, end_date)
  values (
    v_pid,
    to_char(v_start, 'Mon DD') || ' - ' || to_char(v_end, 'Mon DD'),
    coalesce(p_season_id, (select id from public.seasons
                           where is_current and program_id = v_pid
                           order by created_at desc limit 1)),
    v_start, v_end
  )
  returning id into v_id;
  return v_id;
end;
$function$;

-- A fresh approval with no program anywhere no longer joins Boys.
create or replace function public.sync_membership_from_role()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  actor_pid uuid := public.current_program_id();
  pid       uuid;
  m_role    text;
  m_stat    text;
begin
  if new.role in ('pending_player', 'pending_coach') then return new; end if;
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then return new; end if;
  if public.is_platform_admin(new.id) then return new; end if;

  if actor_pid is not null and exists (select 1 from public.program_members
                                        where program_id = actor_pid and user_id = new.id) then
    pid := actor_pid;
  elsif exists (select 1 from public.program_members where user_id = new.id) then
    pid := coalesce(
      (select program_id from public.program_members where user_id = new.id and program_id = new.active_program_id),
      (select program_id from public.program_members where user_id = new.id order by created_at limit 1));
  else
    pid := coalesce(actor_pid, new.active_program_id);
  end if;
  if pid is null then return new; end if;  -- no program to put them in

  m_role := case new.role when 'admin' then 'head_coach' when 'coach' then 'coach' else 'player' end;
  m_stat := case new.role when 'inactive' then 'inactive' else 'active' end;

  insert into public.program_members (program_id, user_id, role, status)
  values (pid, new.id, m_role, m_stat)
  on conflict (program_id, user_id) do update
    set role = excluded.role, status = excluded.status;

  if new.active_program_id is null then
    update public.profiles set active_program_id = pid where id = new.id;
  end if;
  return new;
end
$function$;


-- ── 3. Records: best score respects lower-is-better ──────────
create or replace function public.upsert_record_unguarded(p_type text, p_workout_id uuid, p_workout_title text, p_workout_desc text, p_player_id uuid, p_player_name text, p_avatar_url text, p_value numeric, p_display_value text, p_season text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_pid uuid := public.ctx_program_id();
  v_dir int := 1;
  existing_val numeric;
  is_new_record boolean := false;
begin
  if v_pid is null then return false; end if;
  if p_type = 'best_score' and p_workout_id is not null then
    select case when coalesce(lower_is_better, false) then -1 else 1 end into v_dir
      from public.workouts where id = p_workout_id;
    v_dir := coalesce(v_dir, 1);
  end if;

  select value into existing_val
    from public.records
   where program_id = v_pid
     and record_type = p_type
     and (workout_id = p_workout_id or (p_workout_id is null and workout_id is null))
   order by value * v_dir desc
   limit 1;

  if existing_val is null or p_value * v_dir > existing_val * v_dir then
    if p_workout_id is null then
      -- One row per record type (nulls never clash on the unique key).
      delete from public.records
       where program_id = v_pid and record_type = p_type and workout_id is null;
    end if;
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


-- ── 4. Rebuild Hall of Fame records, program by program ──────
do $$
declare
  pr record;
  v_season text := case when extract(month from current_date) >= 6
                        then extract(year from current_date)::int || '-' || (extract(year from current_date)::int + 1)
                        else (extract(year from current_date)::int - 1) || '-' || extract(year from current_date)::int end;
  r record;
begin
  for pr in select id from public.programs loop
    perform set_config('ww.program_id', pr.id::text, true);

    -- Best score per drill (drill direction respected; first to reach it wins ties)
    for r in
      select distinct on (w.id) w.id as wid, w.title, coalesce(w.description, '') as wdesc,
             pb.player_id, p.name, p.avatar_url, pb.raw_score
        from public.workouts w
        join public.personal_bests pb on pb.workout_id = w.id
        join public.profiles p on p.id = pb.player_id and p.role = 'player'
       where w.program_id = pr.id
         and not exists (select 1 from public.records x
                          where x.program_id = pr.id and x.record_type = 'best_score' and x.workout_id = w.id)
       order by w.id, pb.raw_score * case when coalesce(w.lower_is_better, false) then -1 else 1 end desc, pb.achieved_at
    loop
      perform public.upsert_record_unguarded('best_score', r.wid, r.title, r.wdesc,
                                             r.player_id, r.name, r.avatar_url, r.raw_score, r.raw_score::text, v_season);
    end loop;

    -- Most points (all-time)
    if not exists (select 1 from public.records where program_id = pr.id and record_type = 'most_points_alltime') then
      select o.player_id, p.name, p.avatar_url, o.total into r
        from public.overall_points() o join public.profiles p on p.id = o.player_id
       where o.total > 0 order by o.total desc, p.name limit 1;
      if found then
        perform public.upsert_record_unguarded('most_points_alltime', null, null, null, r.player_id, r.name, r.avatar_url,
                                               r.total, r.total || ' pts', v_season);
      end if;
    end if;

    -- Most drills logged (all-time)
    if not exists (select 1 from public.records where program_id = pr.id and record_type = 'most_workouts_alltime') then
      select s.player_id, p.name, p.avatar_url, count(distinct s.workout_id) as n into r
        from public.scores s join public.profiles p on p.id = s.player_id and p.role = 'player'
       where s.program_id = pr.id
       group by s.player_id, p.name, p.avatar_url
       order by n desc, p.name limit 1;
      if found then
        perform public.upsert_record_unguarded('most_workouts_alltime', null, null, null, r.player_id, r.name, r.avatar_url,
                                               r.n, r.n || ' workouts', v_season);
      end if;
    end if;

    -- H2H: most wins, best win rate (10+ played)
    if not exists (select 1 from public.records where program_id = pr.id and record_type = 'most_challenges_won') then
      select x.pid as player_id, p.name, p.avatar_url, x.wins into r
        from (select pid, count(*) filter (where winner_id = pid) as wins
                from public.challenges c, lateral (values (c.challenger_id), (c.opponent_id)) v(pid)
               where c.program_id = pr.id and c.status = 'completed'
               group by pid) x
        join public.profiles p on p.id = x.pid and p.role = 'player'
       where x.wins > 0 order by x.wins desc, p.name limit 1;
      if found then
        perform public.upsert_record_unguarded('most_challenges_won', null, null, null, r.player_id, r.name, r.avatar_url,
                                               r.wins, r.wins || ' wins', v_season);
      end if;
    end if;
    if not exists (select 1 from public.records where program_id = pr.id and record_type = 'best_win_rate') then
      select x.pid as player_id, p.name, p.avatar_url, x.wins, x.played into r
        from (select pid, count(*) filter (where winner_id = pid) as wins, count(*) as played
                from public.challenges c, lateral (values (c.challenger_id), (c.opponent_id)) v(pid)
               where c.program_id = pr.id and c.status = 'completed'
               group by pid) x
        join public.profiles p on p.id = x.pid and p.role = 'player'
       where x.played >= 10 and x.wins > 0
       order by x.wins * 1.0 / x.played desc, x.played desc, p.name limit 1;
      if found then
        perform public.upsert_record_unguarded('best_win_rate', null, null, null, r.player_id, r.name, r.avatar_url,
                                               round(r.wins * 100.0 / r.played),
                                               round(r.wins * 100.0 / r.played) || '% (' || r.wins || '/' || r.played || ')', v_season);
      end if;
    end if;

    -- Longest streak
    if not exists (select 1 from public.records where program_id = pr.id and record_type = 'longest_streak') then
      select s.player_id, p.name, p.avatar_url, s.longest_streak into r
        from public.streaks s join public.profiles p on p.id = s.player_id and p.role = 'player'
       where s.program_id = pr.id and coalesce(s.longest_streak, 0) > 0
       order by s.longest_streak desc, p.name limit 1;
      if found then
        perform public.upsert_record_unguarded('longest_streak', null, null, null, r.player_id, r.name, r.avatar_url,
                                               r.longest_streak, r.longest_streak || ' days', v_season);
      end if;
    end if;
  end loop;
  perform set_config('ww.program_id', '', true);
end $$;


-- ── 5. Unused dashboard function ─────────────────────────────
drop function if exists public.send_welcome_email(text, text, text, text);

commit;


-- ── Check ─────────────────────────────────────────────────────
-- One row per program: how many records now (Boys should have one per
-- drill with a logged score, plus up to 5 all-time records), and people
-- in the program with no program selected (should be 0).
-- Last row: accounts in NO program at all (pending signups without a
-- team code, old test logins) -- nothing to do, just so you know.
select pr.name as program,
       (select count(*) from public.records r where r.program_id = pr.id and r.record_type = 'best_score') as drill_records,
       (select string_agg(r.record_type || ': ' || r.player_name || ' ' || r.display_value, ' · ' order by r.record_type)
          from public.records r where r.program_id = pr.id and r.workout_id is null) as all_time_records,
       (select count(*) from public.program_members m join public.profiles p on p.id = m.user_id
         where m.program_id = pr.id and p.active_program_id is null) as members_without_program
  from public.programs pr
union all
select '(no program)', null,
       (select count(*)::text || ' account(s) not in any program' from public.profiles p
         where not exists (select 1 from public.program_members m where m.user_id = p.id)
           and not exists (select 1 from public.platform_admins a where a.user_id = p.id)),
       null
 order by 1;
