-- ============================================================
-- 215_drill_setups.sql
--
-- Saved drill setups ("3-line layups", "shell spots") in the drill
-- designer. They live with the saved play sets (formations) under their
-- own side, 'drill', so the play designer's template picker never shows
-- them and the drill designer only shows these.
--
-- Safe to run more than once. Changes nothing that already exists.
-- ============================================================

alter table public.formations drop constraint if exists formations_side_check;
alter table public.formations add constraint formations_side_check
  check (side in ('offense', 'defense', 'blob', 'slob', 'drill'));
