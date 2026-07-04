-- ─────────────────────────────────────────────────────────────
-- 022_rerank_workout.sql
-- CRITICAL: Run this in Supabase SQL Editor
-- This fixes competitive scoring - points were never being assigned
-- ─────────────────────────────────────────────────────────────

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
  r RECORD;
  v_rank integer := 1;
  v_prev_raw numeric := NULL;
  v_prev_rank integer := 1;
BEGIN
  -- Re-rank all scores for this workout by raw score descending
  -- Players with same raw score share the same rank (tie handling)
  FOR r IN
    SELECT
      s.id,
      s.player_id,
      CASE
        WHEN s.self_points > 0 THEN s.self_points
        WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
        ELSE s.made + s.reps
      END AS raw_score
    FROM public.scores s
    WHERE s.workout_id = p_workout_id
    ORDER BY
      CASE
        WHEN s.self_points > 0 THEN s.self_points
        WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
        ELSE s.made + s.reps
      END DESC
  LOOP
    -- Handle ties — same raw score = same rank
    IF v_prev_raw IS NOT NULL AND r.raw_score <> v_prev_raw THEN
      v_rank := v_rank + 1;
    END IF;

    UPDATE public.scores
    SET points = CASE
      WHEN v_rank = 1 THEN p_first_pts
      WHEN v_rank = 2 THEN p_second_pts
      WHEN v_rank = 3 THEN p_third_pts
      ELSE 0
    END
    WHERE id = r.id;

    v_prev_raw := r.raw_score;
    v_rank := v_rank + 1;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rerank_workout(uuid, integer, integer, integer) TO authenticated;

-- Now fix all existing competitive scores that have 0 points
-- by re-running the rerank for every workout
DO $$
DECLARE
  w RECORD;
BEGIN
  FOR w IN
    SELECT DISTINCT s.workout_id, wk.first_place_pts, wk.second_place_pts, wk.third_place_pts
    FROM public.scores s
    JOIN public.workouts wk ON wk.id = s.workout_id
    WHERE wk.scoring_type = 'competitive'
  LOOP
    PERFORM public.rerank_workout(
      w.workout_id,
      COALESCE(w.first_place_pts, 3),
      COALESCE(w.second_place_pts, 2),
      COALESCE(w.third_place_pts, 1)
    );
  END LOOP;
END;
$$;
