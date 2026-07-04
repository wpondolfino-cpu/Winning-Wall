-- ─────────────────────────────────────────────────────────────
-- 022b_fix_scores.sql
-- Run AFTER 022_rerank_workout.sql
-- Diagnoses and fixes any remaining point issues
-- ─────────────────────────────────────────────────────────────

-- Check what scoring_type your workouts have
SELECT id, title, scoring_type, first_place_pts, second_place_pts, third_place_pts
FROM public.workouts
ORDER BY created_at;

-- Check current scores with their points
SELECT s.player_id, p.name, w.title, w.scoring_type,
       s.made, s.reps, s.self_points, s.points
FROM public.scores s
JOIN public.profiles p ON p.id = s.player_id
JOIN public.workouts w ON w.id = s.workout_id
ORDER BY w.title, s.points DESC;

-- Force re-rank ALL competitive workouts right now
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

-- Verify scores now have correct points
SELECT s.player_id, p.name, w.title, s.made + s.reps as raw_score, s.points
FROM public.scores s
JOIN public.profiles p ON p.id = s.player_id
JOIN public.workouts w ON w.id = s.workout_id
ORDER BY w.title, s.points DESC;
