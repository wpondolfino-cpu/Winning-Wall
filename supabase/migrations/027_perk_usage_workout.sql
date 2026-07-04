-- 027_perk_usage_workout.sql
-- Adds workout_id to perk_usage so leaderboard can show ⚡+5 indicator
ALTER TABLE public.perk_usage ADD COLUMN IF NOT EXISTS workout_id uuid REFERENCES public.workouts(id) ON DELETE SET NULL;
