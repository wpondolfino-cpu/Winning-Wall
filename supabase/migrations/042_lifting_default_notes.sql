-- Add default_notes to exercise bank
ALTER TABLE public.lifting_exercise_bank 
  ADD COLUMN IF NOT EXISTS default_notes text DEFAULT NULL;
