-- 088_negative_scores_and_tiebreak.sql
-- Two additive features, both opt-in per workout so nothing about any
-- existing workout's behavior changes unless a coach explicitly turns it on:
--
-- 1. allow_negative — lets a workout's score inputs accept negative
--    numbers (e.g. a drill where a miss is -2). Purely a UI-permission
--    flag; scoring math already handles negative raw scores today.
--
-- 2. tiebreak_mode — when two players are tied on raw score for a
--    competitive/multi_spot workout, breaks the tie with a secondary
--    metric: 'free_throw' (higher makes wins) or 'fastest_time' (lower
--    seconds wins). tiebreak_value on scores/score_attempts stores
--    whichever of those two the coach picked. A player with no
--    tiebreak value on file always loses the tiebreak to a player who
--    has one — they simply keep the shared tied points, they never
--    move to a WORSE rank than the tie they were already in.

alter table public.workouts
  add column if not exists allow_negative boolean not null default false;

alter table public.workouts
  add column if not exists tiebreak_mode text null;

alter table public.workouts
  drop constraint if exists workouts_tiebreak_mode_check;
alter table public.workouts
  add constraint workouts_tiebreak_mode_check
  check (tiebreak_mode is null or tiebreak_mode in ('free_throw', 'fastest_time'));

alter table public.scores
  add column if not exists tiebreak_value numeric null;

alter table public.score_attempts
  add column if not exists tiebreak_value numeric null;

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
BEGIN
  SELECT lower_is_better, tiebreak_mode INTO v_lower_is_better, v_tiebreak_mode
  FROM public.workouts WHERE id = p_workout_id;
  v_lower_is_better := COALESCE(v_lower_is_better, false);
  -- 1 reproduces today's always-DESC ordering exactly (the existing,
  -- untouched behavior); -1 flips it for a workout that opts into
  -- "lower score wins". raw_score itself is never negated -- only the
  -- ORDER BY -- so ties and the stored value both stay the true score.
  v_dir := CASE WHEN v_lower_is_better THEN -1 ELSE 1 END;
  -- fastest_time: lower tiebreak value wins -> ascending -> multiply by -1
  -- for a DESC order-by. free_throw: higher wins -> DESC as-is -> 1.
  -- No tiebreak_mode -> 0, so the tiebreak term never affects ordering
  -- and the tie-detection below always finds prev/curr "equal" on it.
  v_tie_dir := CASE
    WHEN v_tiebreak_mode = 'fastest_time' THEN -1
    WHEN v_tiebreak_mode = 'free_throw' THEN 1
    ELSE 0
  END;

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

      -- Truly tied (same rank/points) only if raw score matches AND
      -- the tiebreak resolves to the same thing (both null, or equal
      -- values). If one side has a tiebreak value and the other
      -- doesn't -- or they differ -- rank advances even on a raw tie.
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

  -- Also handle players with no grade_category (rank them together)
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
      AND p.grade_category IS NULL
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.rerank_workout(uuid, integer, integer, integer) TO authenticated;
