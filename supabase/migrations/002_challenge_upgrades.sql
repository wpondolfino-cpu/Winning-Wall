-- ─────────────────────────────────────────────────────────────
-- 002_challenge_upgrades.sql
-- Run this in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Add "seen" flag to challenges so we can show the red dot
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS opponent_seen boolean DEFAULT false;

-- 2. Add winner tracking to completed challenges
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS winner_id text;

-- Update existing completed rows to populate winner_id
UPDATE challenges
SET winner_id = CASE
  WHEN challenger_score > opponent_score THEN challenger_id
  WHEN opponent_score > challenger_score THEN opponent_id
  ELSE NULL  -- ties
END
WHERE status = 'completed' AND opponent_score IS NOT NULL;

-- 3. Create a view for all-time challenge stats per player
-- (used by the Stats section in HeadToHead)
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

-- 4. Allow the badges table to accept "challenges_won" as a trigger_type
-- (If you used a CHECK constraint on trigger_type, update it here.
--  If no constraint exists, this is a no-op — badges.ts handles the logic.)

-- 5. RLS: players can update opponent_seen and winner_id on their own challenges
-- (Existing RLS on challenges table should already allow this via challenger/opponent check)
-- If you have strict policies, run:
-- ALTER POLICY "Players can update own challenges" ON challenges
--   USING (auth.uid() = challenger_id OR auth.uid() = opponent_id);
