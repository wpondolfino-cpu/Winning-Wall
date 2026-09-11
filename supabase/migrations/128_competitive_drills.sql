-- 128_competitive_drills.sql
--
-- Marks a drill as one somebody can win.
--
-- The practice wins tool asks for a drill name as free text, which is a
-- bad thing to type mid-practice and produces "Shell Drill" and
-- "shell drill" as two different entries in the history. Offering the
-- practice's own drills fixes both, but most practices contain plenty of
-- drills nobody wins — a warm-up, form shooting, a walkthrough — and a
-- list of all of them is nearly as slow to read as typing.
--
-- So the flag sits with the other library defaults. Mark Shell Drill
-- competitive once and it's competitive every time you use it, the same
-- way default_duration_minutes works.
--
-- The per-placement override is for the night you run something
-- competitively that usually isn't, and it's nullable so "no opinion"
-- stays distinct from "explicitly not": null means fall back to the
-- library, false means not tonight.

alter table public.practice_drills_library
  add column if not exists is_competitive boolean not null default false;

comment on column public.practice_drills_library.is_competitive is
  'Whether this drill has a winner. Drives which drills the practice wins tool offers. A default, like default_duration_minutes — overridable per placement.';

alter table public.segment_drills
  add column if not exists is_competitive boolean;

comment on column public.segment_drills.is_competitive is
  'Overrides the library drill''s is_competitive for this placement only. Null means follow the library.';
