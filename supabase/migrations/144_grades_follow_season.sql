-- 144_grades_follow_season.sql
--
-- Grade moves up when a new season starts, not on a hardcoded August 1.
--
-- Two problems this fixes:
--
--   1. The grade rule lived in the client as "August onwards is next
--      year". Seasons now have their own start date, so the app had two
--      calendars that could disagree.
--
--   2. The leaderboard doesn't group by the derived grade. It groups by
--      profiles.grade_category, a stored label, and the only thing that
--      ever recalculated it was a coach saving that one player in the
--      Edit modal. Nobody moved up a leaderboard group on their own.
--
-- THE RULE: the current season's graduating class is the year after it
-- starts. A season that starts Aug 2026, Nov 2026 or Mar 2027 (the
-- flip-to-offseason rollover) is the class of 2027 / 2027 / 2028. The
-- only start that reads wrong is a January one, which nothing does.
--
-- sync_grades_to_season() is idempotent: it sets every player with a
-- graduation year to the label their grade calls for, and is called by
-- the client whenever the current season changes (start a new one, make
-- an earlier one current again, edit the current one's start date).
--
-- grade_category stays the ranking key, and its VALUES don't change.
-- hall_of_fame and season_history snapshot it as text, and the rollover
-- archives BEFORE a new season starts, so past seasons keep their labels.

-- ── Which graduating class is "seniors" right now ─────────────
-- Callable before sign-in (the signup form needs it to turn "10th grade"
-- into a graduation year), hence security definer + anon.
create or replace function public.current_academic_year()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select extract(year from start_date)::int + 1
       from public.seasons
      where is_current and start_date is not null
      limit 1),
    -- No current season yet: fall back to the old August rule.
    case when extract(month from current_date) >= 8
      then extract(year from current_date)::int + 1
      else extract(year from current_date)::int end
  );
$$;

grant execute on function public.current_academic_year() to anon, authenticated;

-- ── Move everyone's leaderboard group to match ────────────────
-- p_clear_alumni_rosters: also take graduates off their home roster and
-- clear their jersey. Passed true only when a NEW season starts; a
-- correction (editing a date, re-selecting a season) only fixes grades.
create or replace function public.sync_grades_to_season(p_clear_alumni_rosters boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year     int := public.current_academic_year();
  v_updated  int := 0;
  v_cleared  int := 0;
  v_missing  int := 0;
  w          record;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'Only coaches can move grades';
  end if;

  with target as (
    select id,
           case
             when 12 - (graduation_year - v_year) > 12 then 'Alumni'
             when 12 - (graduation_year - v_year) >= 11 then 'Upperclassman (11th-12th Grade)'
             when 12 - (graduation_year - v_year) >= 9  then 'Underclassman (9th-10th Grade)'
             else null   -- incoming class, not in high school yet: leave alone
           end as label
      from public.profiles
     where role in ('player', 'inactive', 'pending_player')
       and graduation_year is not null
  )
  update public.profiles p
     set grade_category = t.label
    from target t
   where p.id = t.id
     and t.label is not null
     and p.grade_category is distinct from t.label;
  get diagnostics v_updated = row_count;

  if p_clear_alumni_rosters then
    update public.profiles
       set home_roster_id = null, jersey = null
     where graduation_year is not null
       and 12 - (graduation_year - v_year) > 12
       and home_roster_id is not null;
    get diagnostics v_cleared = row_count;
  end if;

  select count(*) into v_missing
    from public.profiles
   where role = 'player' and graduation_year is null;

  -- Placings are awarded within each leaderboard group, so a player who
  -- changed group leaves every competitive drill's placings stale.
  if v_updated > 0 then
    for w in
      select id, first_place_pts, second_place_pts, third_place_pts
        from public.workouts where scoring_type = 'competitive'
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

grant execute on function public.sync_grades_to_season(boolean) to authenticated;

-- ── Optional: bring labels into line now ──────────────────────
-- Nothing above changes any data. Existing labels have only ever been
-- set by hand, so some are likely stale. To see what a sync would move:
--
--   select name, graduation_year, grade_category as now,
--     case
--       when 12 - (graduation_year - public.current_academic_year()) > 12 then 'Alumni'
--       when 12 - (graduation_year - public.current_academic_year()) >= 11 then 'Upperclassman (11th-12th Grade)'
--       when 12 - (graduation_year - public.current_academic_year()) >= 9  then 'Underclassman (9th-10th Grade)'
--     end as becomes
--   from public.profiles
--   where role = 'player' and graduation_year is not null
--   order by name;
--
-- It re-ranks competitive drills if anything moves, so mid-period it can
-- shuffle placings. The next season start does it anyway. To apply now,
-- run from the app while signed in as a coach, or from the SQL editor
-- (the SQL editor has no auth.uid(), so run the update in the function
-- body by hand instead of calling it).
