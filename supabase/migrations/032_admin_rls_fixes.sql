-- 032_admin_rls_fixes.sql
-- Gives admin full access to scores, streaks, announcements, and workouts

-- Admin can update any player's score
CREATE POLICY "scores_admin_update" ON public.scores
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin can insert scores for any player
CREATE POLICY "scores_admin_insert" ON public.scores
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin can update any player's streak
CREATE POLICY "streaks_admin_update" ON public.streaks
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin can delete any announcement
CREATE POLICY "announcements_admin_delete" ON public.announcements
FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin can delete any workout
CREATE POLICY "workouts_admin_delete" ON public.workouts
FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
