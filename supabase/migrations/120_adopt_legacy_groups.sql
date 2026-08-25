-- 120_adopt_legacy_groups.sql
--
-- Makes older workout blocks reachable from Group Manager.
--
-- Groups arrived in migration 052. Workouts created before that carry a
-- group_name STRING and no group_id, so a block like "Week 1 & 2" shows
-- up as a filter chip in Manage Workouts but has no row in Group Manager
-- at all -- no Run again, no publish, no way to bring it back.
--
-- This creates a real group for every distinct group_name that doesn't
-- have one, and links its workouts. They then behave exactly like groups
-- made since: publishable, archivable, re-runnable.
--
-- Status is 'archived' rather than 'active' on purpose. These are old
-- blocks that aren't the live one, and publishing is a deliberate act --
-- a migration should never change what players see.

insert into public.workout_groups (name, status)
select distinct w.group_name, 'archived'
from public.workouts w
where w.group_name is not null
  and trim(w.group_name) <> ''
  and w.group_id is null
  and not exists (
    select 1 from public.workout_groups g where g.name = w.group_name
  );

-- Link the workouts to whichever group carries their name — both the ones
-- just created and any that already existed unlinked.
update public.workouts w
  set group_id = g.id
from public.workout_groups g
where w.group_id is null
  and w.group_name is not null
  and g.name = w.group_name;

-- A group whose workouts are currently visible IS the live one; say so,
-- rather than leaving the real live block sitting under "Archived".
update public.workout_groups g
  set status = 'active'
where exists (
  select 1 from public.workouts w
  where w.group_id = g.id and w.is_active is true
);
