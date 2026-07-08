-- 061_records_workout_fk_set_null.sql
-- records.workout_id currently CASCADEs on delete, meaning deleting a
-- workout silently wipes its Hall of Fame record too. Since the record
-- already stores workout_title/workout_desc as its own snapshot columns
-- (same pattern as player_name/avatar_url), it doesn't need the live
-- link to survive — switching to SET NULL, matching player_id's behavior.

alter table public.records drop constraint records_workout_id_fkey;

alter table public.records
  add constraint records_workout_id_fkey
  foreign key (workout_id) references public.workouts(id) on delete set null;
