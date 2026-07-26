-- 084_lower_is_better_ranking.sql
-- Adds a per-workout "lower score wins" option (e.g. "fewest attempts to
-- make 7"), generalizing the one-off trick the "seconds -- fastest wins"
-- metric already used (negating the raw score so a smaller time still
-- sorts to the top of an always-descending order). That trick only ever
-- worked for the dedicated sprint_secs column; this makes it a real,
-- explicit per-workout flag any competitive/multi-spot workout can opt
-- into, regardless of which numeric field it scores off of.
--
-- Every existing workout defaults to lower_is_better = false, and for
-- that default, the ranking function below produces the exact same
-- ordering it already did (multiplying by 1 is a no-op) -- nothing about
-- how any current workout ranks changes. The only new behavior is for a
-- workout that explicitly opts in.

alter table public.workouts
  add column if not exists lower_is_better boolean not null default false;

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
  v_lower_is_better boolean;
  v_dir integer;
BEGIN
  SELECT lower_is_better INTO v_lower_is_better FROM public.workouts WHERE id = p_workout_id;
  v_lower_is_better := COALESCE(v_lower_is_better, false);
  -- 1 reproduces today's always-DESC ordering exactly (the existing,
  -- untouched behavior); -1 flips it for a workout that opts into
  -- "lower score wins". raw_score itself is never negated -- only the
  -- ORDER BY -- so ties and the stored value both stay the true score.
  v_dir := CASE WHEN v_lower_is_better THEN -1 ELSE 1 END;

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
        (CASE
          WHEN s.self_points > 0 THEN s.self_points
          WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
          ELSE s.made + s.reps
        END) * v_dir DESC
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
      (CASE
        WHEN s.self_points > 0 THEN s.self_points
        WHEN s.sprint_secs > 0 AND s.made = 0 AND s.reps = 0 THEN -s.sprint_secs
        ELSE s.made + s.reps
      END) * v_dir DESC
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
