-- ─────────────────────────────────────────────────────────────
-- 008_fix_avatar_rls.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Make sure the leaderboard view pulls avatar_url per player
-- (Check what your leaderboard view currently looks like)
SELECT definition FROM pg_views WHERE viewname = 'leaderboard';

-- 2. Nuclear fix for RLS - drop ALL update policies and recreate strictly
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'profiles' AND cmd = 'UPDATE'
  LOOP
    EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON public.profiles';
  END LOOP;
END $$;

-- 3. Recreate ONE strict update policy
CREATE POLICY "own_profile_update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 4. Verify - run this to see all policies on profiles
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'profiles';
