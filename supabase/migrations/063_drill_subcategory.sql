-- 063_drill_subcategory.sql
-- Lets coaches organize the Drill Library with finer sub-groupings within
-- each existing category (e.g. Competing -> "1v1", "2v2"). Purely
-- additive and optional — Manage Workouts doesn't need to touch this at
-- all; only the Drill Library's own filtering/display uses it.

alter table public.workouts
  add column if not exists subcategory text;
