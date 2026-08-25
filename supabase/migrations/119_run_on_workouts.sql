-- 119_run_on_workouts.sql
--
-- Fixes 118 for the groups that actually exist.
--
-- 118 read current_run off workout_groups, reached via workouts.group_id.
-- But the groups in use here are group_name TEXT on the workout — many
-- have no workout_groups row at all, and group_id isn't even in the
-- client model. For those, the join produced null, ranking silently fell
-- back to all-time, and a new run would have done nothing.
--
-- The run belongs on the WORKOUT. That's the thing being ranked, it's
-- what every score points at, and it works whether a group is a real row,
-- a bare name, or absent entirely. Starting a run for a group just means
-- setting it on that group's workouts.
--
-- workout_groups.current_run stays for display, but nothing ranks off it
-- any more.

alter table public.workouts
  add column if not exists current_run int not null default 1;

-- Carry over anything 118 already set on a group row.
update public.workouts w
  set current_run = g.current_run
  from public.workout_groups g
  where g.id = w.group_id and g.current_run > 1;

-- Existing scores belong to whatever run their workout is currently on;
-- anything unstamped would otherwise drop off its board entirely.
update public.scores s
  set run = w.current_run
  from public.workouts w
  where w.id = s.workout_id and s.run is null;

-- Starts the next run for a set of workouts. Takes ids rather than a
-- group so it works for name-only groups too; the caller decides what
-- "the group" means.
create or replace function public.start_group_run_by_workouts(p_workout_ids uuid[], p_run int)
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  update public.workouts set current_run = p_run where id = any(p_workout_ids);
  -- Re-rank now so the board clears immediately rather than at the next
  -- score submission.
  for r in select unnest(p_workout_ids) as id loop
    perform public.rerank_workout(r.id);
  end loop;
end;
$$;

grant execute on function public.start_group_run_by_workouts(uuid[], int) to authenticated;

-- Group-level version, rewritten to drive the workouts rather than the
-- group row, so both paths end up doing the same thing.
create or replace function public.start_group_run(p_group_id uuid)
returns int
language plpgsql
security definer
as $$
declare
  v_run int;
  r record;
begin
  update public.workout_groups
    set current_run = current_run + 1
    where id = p_group_id
    returning current_run into v_run;

  update public.workouts set current_run = v_run where group_id = p_group_id;

  for r in select id from public.workouts where group_id = p_group_id loop
    perform public.rerank_workout(r.id);
  end loop;

  return v_run;
end;
$$;

grant execute on function public.start_group_run(uuid) to authenticated;

-- ── rerank_workout: read the run from the WORKOUT ─────────────
-- Only the v_run lookup changes from 118. Everything else is unchanged,
-- because this function decides every placing in the app.
CREATE OR REPLACE FUNCTION public.rerank_workout(
  p_workout_id  uuid,
  p_first_pts   integer DEFAULT 3,
  p_second_pts  integer DEFAULT 2,
  p_third_pts   integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_grade text;
  r RECORD;
  v_rank integer;
  v_prev_raw numeric;
  v_prev_tiebreak numeric;
  v_prev_pts integer;
  v_lower_is_better boolean;
  v_dir integer;
  v_tiebreak_mode text;
  v_tie_dir integer;
  v_run int;
BEGIN
  SELECT lower_is_better, tiebreak_mode, current_run
    INTO v_lower_is_better, v_tiebreak_mode, v_run
  FROM public.workouts WHERE id = p_workout_id;

  v_lower_is_better := COALESCE(v_lower_is_better, false);
  v_run := COALESCE(v_run, 1);
  v_dir := CASE WHEN v_lower_is_better THEN -1 ELSE 1 END;
  v_tie_dir := CASE
    WHEN v_tiebreak_mode = 'fastest_time' THEN -1
    WHEN v_tiebreak_mode = 'free_throw' THEN 1
    WHEN v_tiebreak_mode = 'spot' THEN v_dir
    ELSE 0
  END;

  -- Scores from earlier runs stop counting, so clear their points rather
  -- than leaving stale placings on rows nobody is ranking.
  UPDATE public.scores SET points = 0
  WHERE workout_id = p_workout_id AND COALESCE(run, 1) <> v_run;

  FOR v_grade IN
    SELECT DISTINCT p.grade_category
    FROM public.scores s
    JOIN public.profiles p ON p.id = s.player_id
    WHERE s.workout_id = p_workout_id
      AND p.grade_category IS NOT NULL
      AND COALESCE(s.run, 1) = v_run
  LOOP
    v_rank := 1;
    v_prev_raw := NULL;
    v_prev_tiebreak := NULL;
    v_prev_pts := p_first_pts;

    FOR r IN
      SELECT
        s.id,
        CASE
          WHEN s.self_points > 0 THEN s.self_points
          WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
          ELSE s.made + s.reps
        END AS raw_score,
        s.tiebreak_value AS tiebreak_value
      FROM public.scores s
      JOIN public.profiles p ON p.id = s.player_id
      WHERE s.workout_id = p_workout_id
        AND p.grade_category = v_grade
        AND COALESCE(s.run, 1) = v_run
      ORDER BY
        (CASE
          WHEN s.self_points > 0 THEN s.self_points
          WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
          ELSE s.made + s.reps
        END) * v_dir DESC,
        (s.tiebreak_value IS NULL) ASC,
        s.tiebreak_value * v_tie_dir DESC
    LOOP
      v_prev_pts := CASE
        WHEN v_rank = 1 THEN p_first_pts
        WHEN v_rank = 2 THEN p_second_pts
        WHEN v_rank = 3 THEN p_third_pts
        ELSE 0
      END;

      IF v_prev_raw IS NOT NULL AND r.raw_score = v_prev_raw
         AND ((r.tiebreak_value IS NULL AND v_prev_tiebreak IS NULL)
              OR r.tiebreak_value = v_prev_tiebreak) THEN
        NULL;
      ELSE
        IF v_prev_raw IS NOT NULL THEN
          v_rank := v_rank + 1;
          v_prev_pts := CASE
            WHEN v_rank = 1 THEN p_first_pts
            WHEN v_rank = 2 THEN p_second_pts
            WHEN v_rank = 3 THEN p_third_pts
            ELSE 0
          END;
        END IF;
      END IF;

      UPDATE public.scores SET points = v_prev_pts WHERE id = r.id;

      v_prev_raw := r.raw_score;
      v_prev_tiebreak := r.tiebreak_value;
    END LOOP;
  END LOOP;
END;
$$;
