-- 031_workouts_admin_policy.sql
-- Allows admin to update any workout regardless of who created it

CREATE POLICY "workouts_admin_update" ON public.workouts
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  )
);
