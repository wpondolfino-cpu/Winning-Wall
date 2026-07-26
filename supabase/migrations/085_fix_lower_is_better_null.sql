-- 085_fix_lower_is_better_null.sql
-- 084 made lower_is_better NOT NULL, which is stricter than it needs to
-- be -- rerank_workout() already does COALESCE(v_lower_is_better, false)
-- when reading it, so a null value is perfectly safe to rank against.
-- The strict NOT NULL is what caused "Save Changes" to fail on any
-- existing workout, since the update path was (incorrectly) sending
-- null for non-competitive/multi-spot workouts. That's fixed in the
-- app code too, but relaxing this here means the same mistake can't
-- ever hard-fail a save again, from this code path or a future one.

alter table public.workouts
  alter column lower_is_better drop not null;
