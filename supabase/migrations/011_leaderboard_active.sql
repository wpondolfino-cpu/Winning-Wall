-- ─────────────────────────────────────────────────────────────
-- 011_leaderboard_active.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- Add leaderboard_active column to workouts
-- true  = counts toward leaderboard (default)
-- false = drill still available for logging/challenges but excluded from leaderboard
ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS leaderboard_active boolean DEFAULT true;

-- Existing workouts should all start as leaderboard active
UPDATE public.workouts SET leaderboard_active = true WHERE leaderboard_active IS NULL;
