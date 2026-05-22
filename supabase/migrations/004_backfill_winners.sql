-- ─────────────────────────────────────────────────────────────
-- 004_backfill_winners.sql  (OPTIONAL)
-- Run this in Supabase SQL Editor to fix old challenges that
-- show as "Tied" even though one person clearly won.
-- ─────────────────────────────────────────────────────────────

UPDATE challenges
SET winner_id = CASE
  WHEN challenger_score > opponent_score THEN challenger_id
  WHEN opponent_score > challenger_score THEN opponent_id
  ELSE NULL  -- genuine tie
END
WHERE status = 'completed'
  AND opponent_score IS NOT NULL
  AND winner_id IS NULL;
