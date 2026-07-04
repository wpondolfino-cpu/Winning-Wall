-- ─────────────────────────────────────────────────────────────
-- 012_email_in_profiles.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Add email column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- 2. Backfill existing profiles with email from auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- 3. Create a trigger to auto-populate email when new profiles are created
CREATE OR REPLACE FUNCTION public.sync_email_to_profile()
RETURNS trigger AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_email_sync ON auth.users;
CREATE TRIGGER on_auth_user_email_sync
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_email_to_profile();
