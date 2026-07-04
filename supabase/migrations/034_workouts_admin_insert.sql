-- 034_workouts_admin_insert.sql
-- Allows admin to create new workouts

CREATE POLICY "workouts_admin_insert" ON public.workouts
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);


SELECT 'Winning Wall setup complete! 🏀' as status;
