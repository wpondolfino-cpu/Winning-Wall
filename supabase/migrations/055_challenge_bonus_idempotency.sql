-- 055_challenge_bonus_idempotency.sql
-- Fixes: double/triple "Challenge Win" bonus points from double-clicking Submit.
-- Adds a challenge_id reference to streak_bonuses so the database itself can
-- refuse to award the same challenge's win bonus twice, no matter how many
-- times the client asks.

ALTER TABLE public.streak_bonuses ADD COLUMN IF NOT EXISTS challenge_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS streak_bonuses_challenge_unique
  ON public.streak_bonuses (challenge_id)
  WHERE reason = 'challenge_win';
