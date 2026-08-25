-- 118_workout_group_runs.sql
--
-- Lets a workout group be run again with a clean leaderboard, without
-- deleting anything.
--
-- Scores hang off the WORKOUT, not the group, so republishing "Week 1"
-- brought back every score ever logged against it -- a kid who ran it in
-- November still sitting on top in February. Deleting those scores would
-- fix the board and destroy the comparison that makes a rerun worth
-- doing ("you did 18, now 24").
--
-- So scores get stamped with the run they belong to, and the leaderboard
-- filters to the current one. History stays whole, personal bests stay
-- all-time, and the board is honest about the competition actually
-- being run.
--
-- Deliberately NOT scoped: personal_bests (all-time is the point of a PB)
-- and hall_of_fame (frozen snapshots of past champions).

alter table public.workout_groups
  add column if not exists current_run int not null default 1;

-- Null means "not part of a group run" -- an ungrouped workout ranks
-- all-time exactly as it does today. Existing scores backfill to run 1
-- below so they don't vanish from the board.
alter table public.scores
  add column if not exists run int;

alter table public.score_attempts
  add column if not exists run int;

update public.scores s
  set run = 1
  from public.workouts w
  where w.id = s.workout_id and w.group_id is not null and s.run is null;

update public.score_attempts a
  set run = 1
  from public.workouts w
  where w.id = a.workout_id and w.group_id is not null and a.run is null;

create index if not exists scores_workout_run_idx on public.scores(workout_id, run);

-- Starts the next run for every workout in a group at once. They're one
-- block of work, so resetting one but not the others would be incoherent.
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

  -- Re-rank each workout so the board reflects the new (empty) run
  -- immediately rather than at the next score submission.
  for r in select id from public.workouts where group_id = p_group_id loop
    perform public.rerank_workout(r.id);
  end loop;

  return v_run;
end;
$$;

grant execute on function public.start_group_run(uuid) to authenticated;

-- ── rerank_workout: rank the CURRENT run only ─────────────────
-- Byte-for-byte migration 110 apart from the run filter. This function
-- decides every leaderboard placing in the app and has broken things
-- twice before, so the surface of the change is kept minimal on purpose.
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
  SELECT lower_is_better, tiebreak_mode INTO v_lower_is_better, v_tiebreak_mode
  FROM public.workouts WHERE id = p_workout_id;
  v_lower_is_better := COALESCE(v_lower_is_better, false);
  v_dir := CASE WHEN v_lower_is_better THEN -1 ELSE 1 END;
  v_tie_dir := CASE
    WHEN v_tiebreak_mode = 'fastest_time' THEN -1
    WHEN v_tiebreak_mode = 'free_throw' THEN 1
    WHEN v_tiebreak_mode = 'spot' THEN v_dir
    ELSE 0
  END;

  -- Null for an ungrouped workout, which makes the filter below a no-op
  -- and leaves all-time ranking exactly as it was.
  SELECT g.current_run INTO v_run
  FROM public.workouts w
  LEFT JOIN public.workout_groups g ON g.id = w.group_id
  WHERE w.id = p_workout_id;

  -- Scores from earlier runs stop counting, so clear their points rather
  -- than leaving stale placings attached to rows nobody is ranking.
  IF v_run IS NOT NULL THEN
    UPDATE public.scores SET points = 0
    WHERE workout_id = p_workout_id AND (run IS NULL OR run <> v_run);
  END IF;

  FOR v_grade IN
    SELECT DISTINCT p.grade_category
    FROM public.scores s
    JOIN public.profiles p ON p.id = s.player_id
    WHERE s.workout_id = p_workout_id
      AND p.grade_category IS NOT NULL
      AND (v_run IS NULL OR s.run = v_run)
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
        AND (v_run IS NULL OR s.run = v_run)
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
