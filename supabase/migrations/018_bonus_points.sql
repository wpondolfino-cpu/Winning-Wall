-- ─────────────────────────────────────────────────────────────
-- 018_bonus_points.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- Add reason column to streak_bonuses to track why bonus was awarded
ALTER TABLE public.streak_bonuses ADD COLUMN IF NOT EXISTS reason text DEFAULT 'streak';

-- Update existing rows
UPDATE public.streak_bonuses SET reason = 'streak' WHERE reason IS NULL;
