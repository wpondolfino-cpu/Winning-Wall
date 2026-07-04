-- ─────────────────────────────────────────────────────────────
-- 020_add_email_to_profiles.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- Add email column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill email from auth.users for existing profiles
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- Create a function to get pending users with email (for admin use)
CREATE OR REPLACE FUNCTION public.get_pending_users()
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  role text,
  grade_category text,
  created_at timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT p.id, p.name, u.email, p.role, p.grade_category, p.created_at
  FROM public.profiles p
  JOIN auth.users u ON p.id = u.id
  WHERE p.role IN ('pending_player', 'pending_coach')
  ORDER BY p.created_at ASC;
$$;

-- Grant access to authenticated users (admins/coaches call this)
GRANT EXECUTE ON FUNCTION public.get_pending_users() TO authenticated;
