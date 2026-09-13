-- 129_station_split_overrides.sql
--
-- Lets a coach set a specific split at a rotating station instead of
-- taking the generated one.
--
-- A station's rule divides whoever arrives, which is right for almost
-- everything and is what makes the arrangement printable. But sometimes
-- you want a particular 4v4 — the split that matters, rather than the one
-- the rule produced.
--
-- Keyed by ROTATION GROUP index, not by round. Each group meets each
-- station exactly once, so the group is the stable identity; the round it
-- happens in is derived from the schedule and would change if stations
-- were reordered.
--
-- Absent means "use the rule", so nothing existing changes and a station
-- only carries the splits you actually cared about. Shape:
--   { "0": [["uuid","uuid"], ["uuid"]], "2": [...] }
-- where "0" is Group A.

alter table public.segment_drills
  add column if not exists split_overrides jsonb not null default '{}'::jsonb;

comment on column public.segment_drills.split_overrides is
  'Per-rotation-group split overrides for this station, keyed by group index as a string. Absent key = use split_rule. Only read on a rotating block.';
