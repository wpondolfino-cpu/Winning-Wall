-- 110_tiebreak_spot_and_h2h.sql
--
-- Extends the tiebreak system from 088 in three directions.
--
-- 1. A THIRD tiebreak mode: 'spot'. On a multi-spot workout, one spot is
--    starred and the score at that spot breaks ties. Unlike free throws
--    and the stopwatch it costs nothing at entry -- the number is already
--    being typed in.
--
--    Direction: the starred spot is a SLICE of the drill's own score, so
--    it follows lower_is_better. If fewer is better overall, fewer is
--    better at that spot. Free throws (higher wins) and fastest time
--    (lower wins) keep fixed directions regardless of the parent drill --
--    otherwise a fewest-wins drill would start awarding ties to whoever
--    was slowest.
--
-- 2. scores.spot_scores. Per-spot values were being thrown away: only the
--    TOTAL was stored on the score row, and spot_personal_bests keeps a
--    best rather than a submission. That made re-deriving impossible --
--    change which spot is starred and there'd be nothing to recompute
--    from. Storing the array costs no extra taps and makes the re-derive
--    below work.
--
-- 3. Tiebreak values on challenges, so a tied head-to-head resolves the
--    same way the leaderboard does.

-- ── 1. starred spot + instruction text ────────────────────────
alter table public.workouts
  add column if not exists tiebreak_spot_index int null;

-- Coach-authored instructions shown with the tiebreak at entry, e.g.
-- "Shoot 10 FTs. Makes +1, Swishes +2. Best score." Per-workout rather
-- than hardcoded: different drills want different rules, and another
-- program's rule won't be this one's.
alter table public.workouts
  add column if not exists tiebreak_instructions text null;

alter table public.workouts drop constraint if exists workouts_tiebreak_mode_check;
alter table public.workouts add constraint workouts_tiebreak_mode_check
  check (tiebreak_mode is null or tiebreak_mode in ('free_throw', 'fastest_time', 'spot'));

-- ── 2. per-spot values on the submission ──────────────────────
alter table public.scores
  add column if not exists spot_scores numeric[] null;

alter table public.score_attempts
  add column if not exists spot_scores numeric[] null;

-- ── 3. head-to-head tiebreaks ─────────────────────────────────
alter table public.challenges
  add column if not exists challenger_tiebreak numeric null;

alter table public.challenges
  add column if not exists opponent_tiebreak numeric null;

-- ── rerank_workout: teach it the third mode ───────────────────
-- Only v_tie_dir changes. Everything else is byte-for-byte 088, because
-- this function decides every leaderboard placing in the app and has
-- broken things twice before -- once on the lower_is_better sign flip and
-- once on a NOT NULL violation. Minimal surface on purpose.
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
  v_dir := CASE WHEN v_lower_is_better THEN -1 ELSE 1 END;
  -- fastest_time: lower wins -> -1. free_throw: higher wins -> 1. Both are
  -- fixed, because they're separate mini-drills rather than part of the
  -- score. 'spot' IS part of the score, so it inherits v_dir.
  -- No mode -> 0, so the term never affects ordering and tie-detection
  -- below always finds prev/curr "equal" on it.
  v_tie_dir := CASE
    WHEN v_tiebreak_mode = 'fastest_time' THEN -1
    WHEN v_tiebreak_mode = 'free_throw' THEN 1
    WHEN v_tiebreak_mode = 'spot' THEN v_dir
    ELSE 0
  END;

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

-- ── re-derive when the starred spot changes ───────────────────
-- Called after a coach saves a workout whose tiebreak setup changed.
--
-- 'spot' re-derives from the stored per-spot arrays, so a changed star
-- applies to every score already on file.
--
-- The other two CLEAR instead. A free throw count and a stopwatch reading
-- are unrecoverable -- nobody wrote them down for a mode that wasn't
-- selected at the time -- and leaving them in place is worse than empty:
-- switching free_throw -> fastest_time would compare FT makes as seconds,
-- with the direction flipped, and silently reorder the board.
CREATE OR REPLACE FUNCTION public.resync_workout_tiebreaks(p_workout_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mode text;
  v_spot int;
BEGIN
  SELECT tiebreak_mode, tiebreak_spot_index INTO v_mode, v_spot
  FROM public.workouts WHERE id = p_workout_id;

  IF v_mode = 'spot' AND v_spot IS NOT NULL THEN
    -- Postgres arrays are 1-based; the app's spot index is 0-based.
    UPDATE public.scores
      SET tiebreak_value = spot_scores[v_spot + 1]
      WHERE workout_id = p_workout_id;
    UPDATE public.score_attempts
      SET tiebreak_value = spot_scores[v_spot + 1]
      WHERE workout_id = p_workout_id;
  ELSIF v_mode IS NULL THEN
    UPDATE public.scores SET tiebreak_value = NULL WHERE workout_id = p_workout_id;
    UPDATE public.score_attempts SET tiebreak_value = NULL WHERE workout_id = p_workout_id;
  END IF;
  -- free_throw / fastest_time deliberately do nothing here. The caller
  -- clears them explicitly on a MODE CHANGE only, so simply re-saving a
  -- workout never wipes values players legitimately entered.
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_workout_tiebreak_values(p_workout_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.scores SET tiebreak_value = NULL WHERE workout_id = p_workout_id;
  UPDATE public.score_attempts SET tiebreak_value = NULL WHERE workout_id = p_workout_id;
END;
$$;

grant execute on function public.resync_workout_tiebreaks(uuid) to authenticated;
grant execute on function public.clear_workout_tiebreak_values(uuid) to authenticated;
