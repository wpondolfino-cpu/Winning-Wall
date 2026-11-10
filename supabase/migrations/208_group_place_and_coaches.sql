-- 208_group_place_and_coaches.sql
-- Lets each group of a drill have a place and its own coaches -- one drill
-- run at three hoops, a coach at each: "Group A · Hoop 1 · Coach Houle".
-- Set from the drill's Coach button when it has groups.
--
--   segment_drill_groups.location   text    e.g. "Hoop 1" (optional)
--   segment_drill_groups.coach_ids  uuid[]  the staff running that group
--
-- Both start empty, so every existing group looks exactly as it does now.
-- Group rows already follow their practice's program rules, so nothing
-- else changes. Safe to run again.

begin;

alter table public.segment_drill_groups
  add column if not exists location  text,
  add column if not exists coach_ids uuid[] not null default '{}';

comment on column public.segment_drill_groups.location  is 'Where this group goes (e.g. Hoop 1). Optional.';
comment on column public.segment_drill_groups.coach_ids is 'Coaches running this group. Shown instead of the drill''s coaches when set.';

commit;

select count(*) as groups_now, count(*) filter (where location is not null or cardinality(coach_ids) > 0) as with_place_or_coach
  from public.segment_drill_groups;
