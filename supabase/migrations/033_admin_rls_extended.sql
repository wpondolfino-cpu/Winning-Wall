-- 033_admin_rls_extended.sql
-- Extends admin access to score_attempts, challenges, notifications, streak_bonuses

-- Admin can manage score attempts
CREATE POLICY "attempts_admin_all" ON public.score_attempts
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin can manage all challenges
CREATE POLICY "challenges_admin_all" ON public.challenges
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin can manage all notifications
CREATE POLICY "notif_admin_all" ON public.notifications
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin can insert streak bonuses for any player
CREATE POLICY "bonuses_admin_all" ON public.streak_bonuses
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
