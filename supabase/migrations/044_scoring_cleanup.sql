-- AHS Winning Wall — Scoring Cleanup
-- Run once after deploying the scores.ts rewrite
-- Safe to run multiple times (all operations are idempotent)

-- ── Step 1: Fix null points ───────────────────────────────────
-- The core bug: self_reported and flat paths wrote self_points
-- but left points as null. Leaderboard sums points, not self_points.

-- Fix self_reported: copy self_points → points
UPDATE scores s
SET points = s.self_points
FROM workouts w
WHERE s.workout_id = w.id
  AND w.scoring_type = 'self_reported'
  AND s.self_points > 0
  AND (s.points IS NULL OR s.points = 0);

-- Fix flat: set points = flat_points for all rows missing points
UPDATE scores s
SET points = w.flat_points
FROM workouts w
WHERE s.workout_id = w.id
  AND w.scoring_type = 'flat'
  AND w.flat_points IS NOT NULL
  AND (s.points IS NULL OR s.points = 0);

-- ── Step 2: Fix Skill Workout competitive columns ─────────────
-- It was accidentally set up with competitive point values
-- causing rerank to run on a flat workout

UPDATE workouts
SET first_place_pts = null, second_place_pts = null, third_place_pts = null
WHERE id = '5b575fb6-6fcd-4b66-b764-8be05c21a7bd';

-- Reset any Skill Workout scores that got inflated by ranking
UPDATE scores
SET points = 1
WHERE workout_id = '5b575fb6-6fcd-4b66-b764-8be05c21a7bd'
  AND points > 1;

-- ── Step 3: Remove zero scores ────────────────────────────────
-- These came from players submitting without entering a value

DELETE FROM score_attempts WHERE raw_score = 0;

DELETE FROM scores
WHERE made = 0
  AND reps = 0
  AND (self_points IS NULL OR self_points = 0)
  AND (sprint_secs IS NULL OR sprint_secs = 0)
  AND (points IS NULL OR points = 0);

-- ── Step 4: Re-rank all competitive workouts ──────────────────
-- After cleaning up bad data, recalculate 1st/2nd/3rd for each
-- competitive workout using correct point values

DO $$
DECLARE
  w RECORD;
BEGIN
  FOR w IN
    SELECT id, first_place_pts, second_place_pts, third_place_pts
    FROM workouts
    WHERE scoring_type IN ('competitive', 'multi_spot')
      AND first_place_pts IS NOT NULL
  LOOP
    PERFORM rerank_workout(w.id, w.first_place_pts, w.second_place_pts, w.third_place_pts);
  END LOOP;
END $$;

-- ── Step 5: Verify ────────────────────────────────────────────
-- Run this to see the leaderboard after cleanup
SELECT name, total_points, workouts_completed, current_streak
FROM leaderboard
ORDER BY total_points DESC;

