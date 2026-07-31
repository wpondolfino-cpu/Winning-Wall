-- 091_opponent_logos_storage.sql
-- Opponent logos were uploading into the "avatars" bucket, whose RLS
-- only allows a user to write into a folder matching their own auth
-- uid (correct for personal avatars, wrong for a shared team asset
-- any coach/admin should be able to set or replace). Giving opponent
-- logos their own bucket with a role-scoped policy instead.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'opponent-logos',
  'opponent-logos',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "opponent_logos_staff_write" ON storage.objects;
CREATE POLICY "opponent_logos_staff_write"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'opponent-logos'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('coach', 'admin'))
)
WITH CHECK (
  bucket_id = 'opponent-logos'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('coach', 'admin'))
);

DROP POLICY IF EXISTS "opponent_logos_public_read" ON storage.objects;
CREATE POLICY "opponent_logos_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'opponent-logos');
