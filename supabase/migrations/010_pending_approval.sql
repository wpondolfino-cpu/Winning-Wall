-- ─────────────────────────────────────────────────────────────
-- 010_pending_approval.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Add "pending_player" and "pending_coach" to allowed roles
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('player', 'coach', 'admin', 'inactive', 'pending_player', 'pending_coach'));

-- 2. Pending users can read their own profile (to show the pending screen)
DROP POLICY IF EXISTS "pending_read_own" ON public.profiles;
CREATE POLICY "pending_read_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- 3. Coaches/admins can see pending profiles to approve them
DROP POLICY IF EXISTS "coaches_see_pending" ON public.profiles;
CREATE POLICY "coaches_see_pending" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p2
      WHERE p2.id = auth.uid()
      AND p2.role IN ('coach', 'admin')
    )
  );
