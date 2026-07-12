-- 065_drill_tags.sql
-- Replaces the single-value subcategory field with a proper multi-tag
-- array — tags are independent of category, and a drill can carry any
-- number of them (e.g. both "Movement" and "2+ People").
-- Existing subcategory values are carried over as each drill's first tag.

alter table public.workouts
  add column if not exists tags text[] not null default '{}';

update public.workouts
  set tags = array[subcategory]
  where subcategory is not null and tags = '{}';
