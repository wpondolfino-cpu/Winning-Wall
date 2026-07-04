-- Lifting Module Phase 1 Tables
-- Programs, exercises, logs, records

CREATE TABLE IF NOT EXISTS public.lifting_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  visibility text NOT NULL DEFAULT 'public',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lifting_program_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid REFERENCES public.lifting_programs(id) ON DELETE CASCADE,
  player_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  UNIQUE(program_id, player_id)
);

CREATE TABLE IF NOT EXISTS public.lifting_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid REFERENCES public.lifting_programs(id) ON DELETE CASCADE,
  name text NOT NULL,
  video_url text,
  target_sets int,
  target_reps int,
  target_weight numeric,
  sort_order int NOT NULL DEFAULT 0,
  hof_eligible boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.lifting_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_id uuid REFERENCES public.lifting_exercises(id) ON DELETE CASCADE,
  logged_at timestamptz NOT NULL DEFAULT now(),
  sets_data jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS public.lifting_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_id uuid REFERENCES public.lifting_exercises(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  avatar_url text,
  best_weight numeric NOT NULL DEFAULT 0,
  best_1rm numeric NOT NULL DEFAULT 0,
  achieved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, exercise_id)
);

ALTER TABLE public.lifting_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifting_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifting_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifting_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifting_program_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_lifting_programs" ON public.lifting_programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_lifting_exercises" ON public.lifting_exercises FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_lifting_assignments" ON public.lifting_program_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_lifting_logs" ON public.lifting_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_lifting_records" ON public.lifting_records FOR ALL USING (true) WITH CHECK (true);
