-- Lifting Module Phase 2 — Days, Exercise Bank, Archive support
-- Run AFTER 004_lifting_phase1.sql

-- Shared exercise bank
CREATE TABLE IF NOT EXISTS public.lifting_exercise_bank (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  muscle_group text NOT NULL DEFAULT 'Other',
  video_url    text,
  default_rest_secs int NOT NULL DEFAULT 90,
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name)
);

-- Days within a program
CREATE TABLE IF NOT EXISTS public.lifting_days (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid REFERENCES public.lifting_programs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  day_number  int NOT NULL,
  is_rest_day boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Exercises assigned to a day
CREATE TABLE IF NOT EXISTS public.lifting_day_exercises (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id          uuid REFERENCES public.lifting_days(id) ON DELETE CASCADE,
  bank_exercise_id uuid REFERENCES public.lifting_exercise_bank(id) ON DELETE CASCADE,
  target_sets     int,
  target_reps     int,
  target_weight   numeric,
  rest_secs       int NOT NULL DEFAULT 90,
  superset_group  int,
  sort_order      int NOT NULL DEFAULT 0
);

-- Add new columns to existing tables
ALTER TABLE public.lifting_programs ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.lifting_programs ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.lifting_logs ADD COLUMN IF NOT EXISTS notes text;

-- RLS
ALTER TABLE public.lifting_exercise_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifting_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifting_day_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_exercise_bank" ON public.lifting_exercise_bank FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_lifting_days" ON public.lifting_days FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_lifting_day_exercises" ON public.lifting_day_exercises FOR ALL USING (true) WITH CHECK (true);
