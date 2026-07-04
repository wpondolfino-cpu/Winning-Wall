-- 030_streak_bonus_awarded_at.sql
-- Adds bonus_awarded_at to streaks table to prevent double-awarding 7-day streak bonus

ALTER TABLE public.streaks ADD COLUMN IF NOT EXISTS bonus_awarded_at date;
