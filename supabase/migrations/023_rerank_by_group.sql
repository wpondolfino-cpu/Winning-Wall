-- ─────────────────────────────────────────────────────────────
-- 023_rerank_by_group.sql
-- CRITICAL: Fixes competitive ranking to be within grade groups
-- and handles ties correctly (tied players share same points)
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
  v_grade text;
  r RECORD;
  v_rank integer;
  v_prev_raw numeric;
  v_prev_pts integer;
BEGIN
  -- Rank within each grade group separately
  FOR v_grade IN
    SELECT DISTINCT p.grade_category
    FROM public.scores s
    JOIN public.profiles p ON p.id = s.player_id
    WHERE s.workout_id = p_workout_id
      AND p.grade_category IS NOT NULL
  LOOP
    v_rank := 1;
    v_prev_raw := NULL;
    v_prev_pts := p_first_pts;

    FOR r IN
      SELECT
        s.id,
        CASE
          WHEN s.self_points > 0 THEN s.self_points
          WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
          ELSE s.made + s.reps
        END AS raw_score
      FROM public.scores s
      JOIN public.profiles p ON p.id = s.player_id
      WHERE s.workout_id = p_workout_id
        AND p.grade_category = v_grade
      ORDER BY
        CASE
          WHEN s.self_points > 0 THEN s.self_points
          WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
          ELSE s.made + s.reps
        END DESC
    LOOP
      -- Determine points for this rank
      v_prev_pts := CASE
        WHEN v_rank = 1 THEN p_first_pts
        WHEN v_rank = 2 THEN p_second_pts
        WHEN v_rank = 3 THEN p_third_pts
        ELSE 0
      END;

      -- If tied with previous player, use same points (don't advance rank)
      IF v_prev_raw IS NOT NULL AND r.raw_score = v_prev_raw THEN
        -- Same score = same points (tie)
        NULL;
      ELSE
        -- Different score — rank advances
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
    END LOOP;
  END LOOP;

  -- Also handle players with no grade_category (rank them together)
  v_rank := 1;
  v_prev_raw := NULL;
  v_prev_pts := p_first_pts;

  FOR r IN
    SELECT
      s.id,
      CASE
        WHEN s.self_points > 0 THEN s.self_points
        WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
        ELSE s.made + s.reps
      END AS raw_score
    FROM public.scores s
    JOIN public.profiles p ON p.id = s.player_id
    WHERE s.workout_id = p_workout_id
      AND p.grade_category IS NULL
    ORDER BY
      CASE
        WHEN s.self_points > 0 THEN s.self_points
        WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
        ELSE s.made + s.reps
      END DESC
  LOOP
    v_prev_pts := CASE
      WHEN v_rank = 1 THEN p_first_pts
      WHEN v_rank = 2 THEN p_second_pts
      WHEN v_rank = 3 THEN p_third_pts
      ELSE 0
    END;

    IF v_prev_raw IS NOT NULL AND r.raw_score = v_prev_raw THEN
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
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rerank_workout(uuid, integer, integer, integer) TO authenticated;

-- Re-run rankings for all competitive workouts with the fixed function
DO $$
DECLARE w RECORD;
BEGIN
  FOR w IN
    SELECT DISTINCT s.workout_id,
      COALESCE(wk.first_place_pts, 3) as fp,
      COALESCE(wk.second_place_pts, 2) as sp,
      COALESCE(wk.third_place_pts, 1) as tp
    FROM public.scores s
    JOIN public.workouts wk ON wk.id = s.workout_id
    WHERE wk.scoring_type = 'competitive'
       OR wk.scoring_type IS NULL
  LOOP
    PERFORM public.rerank_workout(w.workout_id, w.fp, w.sp, w.tp);
  END LOOP;
END;
$$;

-- Show results after fix
SELECT p.name, p.grade_category, w.title, s.made + s.reps as raw_score, s.points
FROM public.scores s
JOIN public.profiles p ON p.id = s.player_id
JOIN public.workouts w ON w.id = s.workout_id
WHERE w.scoring_type = 'competitive' OR w.scoring_type IS NULL
ORDER BY w.title, p.grade_category, s.points DESC;
