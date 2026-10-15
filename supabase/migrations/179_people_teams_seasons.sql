-- ============================================================
-- 179_people_teams_seasons.sql
--
-- MULTI-TENANCY STEP 5 — people, teams and seasons.
--
--  1. Who you can see: only people in the program you're in (plus
--     yourself). Every player list in the app — attendance, rosters,
--     Team Designer, groupings, Practice Wins, leaderboards' names —
--     follows automatically. Pending signups are seen only by the
--     coaches of the program they signed up for.
--  2. Signup with a team code: the code decides the program; the
--     request waits in that program only. check_join_code() lets the
--     signup screen confirm the team before submitting.
--  3. Rosters per program (Girls can have its own "Varsity").
--  4. Seasons per program: each program has its own current season;
--     Girls starts with one named like Boys' current season.
--     Season helpers and "Start new season" grade moves only touch the
--     program you're in.
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Who you can see ────────────────────────────────────────
-- You, anyone in your current program, and — for that program's
-- coaches — people waiting to join it. Platform admin also sees
-- old-style signups that have no program yet.
create or replace function public.can_see_profile(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select target = auth.uid()
      or exists (
           select 1 from public.program_members m
           where m.user_id = target
             and m.program_id = public.current_program_id()
             and (m.status <> 'pending'
                  or public.is_program_staff(m.program_id, auth.uid()))
         )
      or (public.is_platform_admin(auth.uid())
          and not exists (select 1 from public.program_members m where m.user_id = target));
$$;
revoke all on function public.can_see_profile(uuid) from public, anon;
grant execute on function public.can_see_profile(uuid) to authenticated;

drop policy if exists "program_scope" on public.profiles;
create policy "program_scope" on public.profiles
  as restrictive for all
  using (public.can_see_profile(id))
  with check (public.can_see_profile(id));


-- ── 2. Signup with a team code ────────────────────────────────

-- The signup screen calls this (before the person has an account) to
-- show "Joining: Attleboro High School · Boys Basketball".
create or replace function public.check_join_code(code text)
returns json language sql security definer stable set search_path = public as $$
  select json_build_object('program', pr.name, 'school', o.name)
  from public.programs pr join public.organizations o on o.id = pr.organization_id
  where pr.join_code = upper(trim(code)) and pr.is_active
  limit 1;
$$;
revoke all on function public.check_join_code(text) from public;
grant execute on function public.check_join_code(text) to anon, authenticated;

-- Account creation: same as before, plus a PENDING membership in the
-- program the code points to.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role text := case when new.raw_user_meta_data->>'role' in ('pending_player', 'pending_coach')
                      then new.raw_user_meta_data->>'role' else 'pending_player' end;
  v_pid  uuid;
begin
  insert into public.profiles (id, name, role, grade_category, must_change_password, created_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    v_role,
    new.raw_user_meta_data->>'grade_category',
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, false),
    now()
  )
  on conflict (id) do nothing;

  select id into v_pid from public.programs
  where join_code = upper(trim(coalesce(new.raw_user_meta_data->>'join_code', '')))
    and is_active;

  if v_pid is not null then
    insert into public.program_members (program_id, user_id, role, status)
    values (v_pid, new.id, case when v_role = 'pending_coach' then 'coach' else 'player' end, 'pending')
    on conflict (program_id, user_id) do nothing;
    update public.profiles set active_program_id = v_pid where id = new.id;
  end if;
  return new;
end;
$$;


-- ── 3. Rosters: names unique within a program ─────────────────
alter table public.rosters drop constraint if exists rosters_name_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rosters_program_name_key') then
    alter table public.rosters add constraint rosters_program_name_key unique (program_id, name);
  end if;
end $$;
select public.add_program_scope('rosters');


-- ── 4. Seasons: one current season per program ────────────────
drop index if exists public.seasons_one_current_idx;
create unique index if not exists seasons_one_current_per_program
  on public.seasons (program_id) where is_current;
select public.add_program_scope('seasons');

-- Girls' first season, named like Boys' current one.
insert into public.seasons (program_id, name, is_current, start_date)
select g.id, b.name, true, b.start_date
from public.seasons b
join public.programs bp on bp.id = b.program_id and bp.name = 'Boys Basketball'
cross join (select pr.id from public.programs pr
            join public.organizations o on o.id = pr.organization_id
            where o.name = 'Attleboro High School' and pr.name = 'Girls Basketball') g
where b.is_current
  and not exists (select 1 from public.seasons s where s.program_id = g.id);

-- These run with elevated rights, so they filter by program themselves.
-- (Nobody signed in, e.g. the signup screen, falls back to Boys.)
create or replace function public.current_academic_year()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    (select extract(year from start_date)::int + 1
       from public.seasons
      where is_current and start_date is not null
        and program_id = coalesce(public.current_program_id(), public.legacy_default_program_id())
      limit 1),
    case when extract(month from current_date) >= 8
      then extract(year from current_date)::int + 1
      else extract(year from current_date)::int end
  );
$$;

create or replace function public.week_for_date(p_date date, p_season_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pid   uuid := coalesce(public.current_program_id(), public.legacy_default_program_id());
  v_id    uuid;
  v_start date;
  v_end   date;
begin
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
$$;

-- Saved groupings take the program's current season. (Runs before the
-- program label is filled in, hence the fallbacks.)
create or replace function public.saved_groupings_set_season()
returns trigger language plpgsql as $$
declare v_pid uuid := coalesce(new.program_id, public.current_program_id(), public.legacy_default_program_id());
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
$$;

-- "Start new season" grade moves: only this program's players.
create or replace function public.sync_grades_to_season(p_clear_alumni_rosters boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_pid      uuid := public.current_program_id();
  v_year     int  := public.current_academic_year();
  v_updated  int  := 0;
  v_cleared  int  := 0;
  v_missing  int  := 0;
  w          record;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'Only coaches can move grades';
  end if;
  if v_pid is null then raise exception 'Pick a program first'; end if;

  with target as (
    select p.id,
           case
             when 12 - (p.graduation_year - v_year) > 12 then 'Alumni'
             when 12 - (p.graduation_year - v_year) >= 11 then 'Upperclassman (11th-12th Grade)'
             when 12 - (p.graduation_year - v_year) >= 9  then 'Underclassman (9th-10th Grade)'
             else null
           end as label
      from public.profiles p
      join public.program_members m on m.user_id = p.id and m.program_id = v_pid
     where p.role in ('player', 'inactive', 'pending_player')
       and p.graduation_year is not null
  )
  update public.profiles p
     set grade_category = t.label
    from target t
   where p.id = t.id
     and t.label is not null
     and p.grade_category is distinct from t.label;
  get diagnostics v_updated = row_count;

  if p_clear_alumni_rosters then
    update public.profiles p
       set home_roster_id = null, jersey = null
      from public.program_members m
     where m.user_id = p.id and m.program_id = v_pid
       and p.graduation_year is not null
       and 12 - (p.graduation_year - v_year) > 12
       and p.home_roster_id is not null;
    get diagnostics v_cleared = row_count;
  end if;

  select count(*) into v_missing
    from public.profiles p
    join public.program_members m on m.user_id = p.id and m.program_id = v_pid
   where p.role = 'player' and p.graduation_year is null;

  if v_updated > 0 then
    for w in
      select id, first_place_pts, second_place_pts, third_place_pts
        from public.workouts where scoring_type = 'competitive' and program_id = v_pid
    loop
      perform public.rerank_workout(
        w.id,
        coalesce(w.first_place_pts, 3),
        coalesce(w.second_place_pts, 2),
        coalesce(w.third_place_pts, 1)
      );
    end loop;
  end if;

  return json_build_object(
    'academic_year',   v_year,
    'grades_moved',    v_updated,
    'alumni_cleared',  v_cleared,
    'missing_year',    v_missing
  );
end;
$$;

commit;


-- ── Summary ───────────────────────────────────────────────────
select 'tables fenced to their program' as item,
       string_agg(tablename, ', ' order by tablename) as value
from pg_policies where policyname = 'program_scope' and permissive = 'RESTRICTIVE'
union all
select 'current seasons',
       (select string_agg(pr.name || ': ' || s.name, ' | ' order by pr.name)
          from public.seasons s join public.programs pr on pr.id = s.program_id where s.is_current)
union all
select 'rosters per program',
       (select string_agg(pr.name || ': ' || n, ' | ' order by pr.name)
          from (select program_id, count(*)::text n from public.rosters group by 1) x
          join public.programs pr on pr.id = x.program_id)
union all
select 'join code check (Boys)',
       (select public.check_join_code(join_code)::text from public.programs where name = 'Boys Basketball');
