-- 071_avatar_config.sql
-- Stores the actual trait selections (skin tone, hair style, jersey color,
-- etc.) behind a built avatar, separate from the rendered avatar_url image
-- itself. Without this, reopening "Build avatar" had no way to know what
-- was previously chosen and always started over from scratch.

alter table public.profiles
  add column if not exists avatar_config jsonb;
