-- Workout Groups
-- Allows coaches to group workouts and control visibility as a unit

CREATE TABLE IF NOT EXISTS public.workout_groups (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.workout_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Players can read active groups" ON public.workout_groups
  FOR SELECT USING (status = 'active' OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('coach','admin')
  ));
CREATE POLICY "Coaches can manage groups" ON public.workout_groups
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('coach','admin'))
  );

-- Add group_id to workouts (keeps group_name for backward compat)
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.workout_groups(id) ON DELETE SET NULL;

-- View that adds group_status to workouts for easy filtering
CREATE OR REPLACE VIEW public.workouts_with_group AS
SELECT 
  w.*,
  wg.status as group_status,
  wg.name as group_display_name
FROM public.workouts w
LEFT JOIN public.workout_groups wg ON wg.id = w.group_id;
