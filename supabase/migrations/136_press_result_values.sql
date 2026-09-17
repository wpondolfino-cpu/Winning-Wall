-- 136_press_result_values.sql
--
-- Widens possessions.press_result to match the offence side.
--
-- The defence press screen used to ask only what the press produced when
-- it worked or broke down -- turnover, man, zone -- and migration 073
-- pinned the column to those three values. It now offers the same answers
-- the offence gets against a press: they got out in transition, a
-- foul/jump/OOB made it their inbounds, or a backcourt foul sent them to
-- the line (see PressResult in src/lib/gameStats.ts, and 108 for the
-- matching press_break_result values).
--
-- Without this, saving one of the three new answers fails with
-- "violates check constraint possessions_press_result_check" and the
-- possession waits in the tracker's offline queue. Run this, then use
-- Retry on any stuck rows -- they'll go through with their data intact.
--
-- Safe to run on a live database: it only widens what's allowed, so every
-- existing row still passes.

alter table public.possessions
  drop constraint if exists possessions_press_result_check;

alter table public.possessions
  add constraint possessions_press_result_check
  check (press_result is null or press_result in ('turnover', 'man', 'zone', 'transition', 'oob', 'ft_trip'));
