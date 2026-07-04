-- ─────────────────────────────────────────────────────────────
-- 002_challenge_upgrades.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Add "seen" flag to challenges so we can show the red dot
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS opponent_seen boolean DEFAULT false;

-- 2. Add winner tracking to completed challenges
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS winner_id uuid;

-- Update existing completed rows to populate winner_id
UPDATE challenges
SET winner_id = CASE
  WHEN challenger_score > opponent_score THEN challenger_id
  WHEN opponent_score > challenger_score THEN opponent_id
  ELSE NULL
END
WHERE status = 'completed' AND opponent_score IS NOT NULL;

-- 3. Create a view for all-time challenge stats per player
CREATE OR REPLACE VIEW challenge_stats AS
SELECT
  player_id,
  SUM(wins)   AS total_wins,
  SUM(losses) AS total_losses,
  SUM(ties)   AS total_ties
FROM (
  -- as challenger
  SELECT
    challenger_id AS player_id,
    SUM(CASE WHEN winner_id = challenger_id THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN winner_id = opponent_id   THEN 1 ELSE 0 END) AS losses,
    SUM(CASE WHEN winner_id IS NULL AND status = 'completed' THEN 1 ELSE 0 END) AS ties
  FROM challenges
  WHERE status = 'completed'
  GROUP BY challenger_id

  UNION ALL

  -- as opponent
  SELECT
    opponent_id AS player_id,
    SUM(CASE WHEN winner_id = opponent_id   THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN winner_id = challenger_id THEN 1 ELSE 0 END) AS losses,
    SUM(CASE WHEN winner_id IS NULL AND status = 'completed' THEN 1 ELSE 0 END) AS ties
  FROM challenges
  WHERE status = 'completed'
  GROUP BY opponent_id
) sub
GROUP BY player_id;
