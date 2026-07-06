-- 057_streak_bonus_workout_id.sql
-- Lets personal-best bonus rows record which drill they were earned in,
-- so the Score Breakdown can show "Personal Best – Dribbling Workout"
-- instead of just a generic "Bonus".

alter table public.streak_bonuses
  add column if not exists workout_id uuid references public.workouts(id);
