-- 060_fix_upsert_record_conflict_target.sql
-- Root cause of "Hall of Fame drill records never populate": the
-- upsert_record() function uses `ON CONFLICT (record_type, workout_id)`,
-- but no unique constraint/index on exactly those two columns has ever
-- existed on public.records. Postgres requires that constraint to exist
-- before it will even attempt the insert — so every single call has been
-- failing with a 500 error, regardless of whether a real conflict would
-- occur. This explains why every drill (not just one) shows empty.
--
-- Step 1: clean up any accidental duplicate rows first (safe no-op if
-- none exist), keeping only the best value per (record_type, workout_id).
-- Step 2: add the unique constraint the function has always needed.

delete from public.records a
using public.records b
where a.id <> b.id
  and a.record_type = b.record_type
  and coalesce(a.workout_id::text, 'null') = coalesce(b.workout_id::text, 'null')
  and (a.value, a.id) < (b.value, b.id); -- keep the higher value; tie-break by id

alter table public.records
  add constraint records_type_workout_uniq unique (record_type, workout_id);
