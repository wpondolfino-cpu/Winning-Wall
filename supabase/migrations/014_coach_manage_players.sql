-- ─────────────────────────────────────────────────────────────
-- 014_coach_manage_players.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- Allow coaches/admins to update any player/inactive profile
-- (needed for Remove = set role to inactive)
CREATE POLICY "coaches_update_players" ON public.profiles
  FOR UPDATE
  USING (
    role IN ('player', 'inactive')
    AND EXISTS (
      SELECT 1 FROM public.profiles approver
      WHERE approver.id = auth.uid()
      AND approver.role IN ('coach', 'admin')
    )
  )
  WITH CHECK (true);

-- Allow coaches/admins to delete player profiles
-- (needed for Delete player)
CREATE POLICY "coaches_delete_players" ON public.profiles
  FOR DELETE
  USING (
    role IN ('player', 'inactive')
    AND EXISTS (
      SELECT 1 FROM public.profiles approver
      WHERE approver.id = auth.uid()
      AND approver.role IN ('coach', 'admin')
    )
  );

-- Allow coaches/admins to delete scores (needed for Delete player)
DROP POLICY IF EXISTS "coaches_delete_scores" ON public.scores;
CREATE POLICY "coaches_delete_scores" ON public.scores
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('coach', 'admin')
    )
  );
