-- 070_avatar_svg_mime.sql
-- The avatars bucket (003_avatar_storage.sql) only allowed
-- jpeg/png/webp/gif — the new avatar builder saves an SVG, which the
-- bucket was rejecting outright before the file ever touched app code.

UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'image/svg+xml')
WHERE id = 'avatars'
  AND NOT ('image/svg+xml' = ANY(allowed_mime_types));
