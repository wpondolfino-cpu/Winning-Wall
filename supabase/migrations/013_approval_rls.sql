-- ─────────────────────────────────────────────────────────────
-- 013_approval_rls.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Allow coaches/admins to update role on pending accounts
CREATE POLICY "coaches_approve_pending" ON public.profiles
  FOR UPDATE
  USING (
    role IN ('pending_player', 'pending_coach')
    AND EXISTS (
      SELECT 1 FROM public.profiles approver
      WHERE approver.id = auth.uid()
      AND approver.role IN ('coach', 'admin')
    )
  )
  WITH CHECK (true);

-- 2. Allow coaches/admins to delete pending accounts
CREATE POLICY "coaches_reject_pending" ON public.profiles
  FOR DELETE
  USING (
    role IN ('pending_player', 'pending_coach')
    AND EXISTS (
      SELECT 1 FROM public.profiles approver
      WHERE approver.id = auth.uid()
      AND approver.role IN ('coach', 'admin')
    )
  );

-- 3. RPC function to delete auth user (needed for full account rejection)
-- This runs with elevated privileges so it can delete from auth.users
CREATE OR REPLACE FUNCTION public.delete_pending_user(target_user_id uuid)
RETURNS void AS $$
BEGIN
  -- Only allow deletion of pending users
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = target_user_id
    AND role IN ('pending_player', 'pending_coach')
  ) THEN
    DELETE FROM auth.users WHERE id = target_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_pending_user(uuid) TO authenticated;
