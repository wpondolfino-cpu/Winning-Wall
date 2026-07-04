-- Add notes column to lifting_day_exercises
ALTER TABLE public.lifting_day_exercises 
  ADD COLUMN IF NOT EXISTS notes text DEFAULT NULL;
