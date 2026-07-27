-- 087_formation_categories.sql
-- Extends templates (formations table) from 2 categories (offense/
-- defense) to 4 parallel ones: offense, defense, blob, slob -- so the
-- "Pick a template" picker gets 4 tabs instead of 2 as the library
-- grows. BLOB/SLOB templates store player positions the same way
-- offense templates do (they're inbounding-team formations).

alter table public.formations
  drop constraint if exists formations_side_check;

alter table public.formations
  add constraint formations_side_check check (side in ('offense', 'defense', 'blob', 'slob'));
