-- ─────────────────────────────────────────────────────────────
-- 007_fix_profile_rls.sql
-- Run in Supabase SQL Editor
-- Fixes profile updates affecting ALL users instead of just the logged-in user
-- ─────────────────────────────────────────────────────────────

-- Drop any existing update policies on profiles
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "Enable update for users based on id" ON public.profiles;

-- Create a strict policy: users can ONLY update their OWN profile row
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Verify RLS is enabled on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
