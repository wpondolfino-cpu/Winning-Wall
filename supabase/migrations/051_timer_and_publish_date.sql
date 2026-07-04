-- Add timer_duration to workouts table
-- NULL = no timer, value in seconds = show timer in workout
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS timer_duration int DEFAULT NULL;

-- Add publish_date to workouts — workout stays hidden until this date
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS publish_date date DEFAULT NULL;
