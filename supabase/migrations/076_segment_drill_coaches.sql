-- 076_segment_drill_coaches.sql
-- Replaces the single free-text coach_name on segment_drills with a
-- real multi-coach assignment referencing actual coach/admin profiles,
-- so a drill can have more than one coach and picks from real accounts
-- instead of typed names.

alter table public.segment_drills
  add column if not exists coach_ids uuid[] not null default '{}';

-- coach_name is left in place (unused going forward) rather than
-- dropped, so nothing breaks if any row already has it set.
