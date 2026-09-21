-- 139_practice_expected_end.sql
--
-- An end time you can set yourself.
--
-- A practice had a start and nothing else. An end could only be worked
-- out by adding up its blocks, so a practice you'd put on the calendar
-- before building it had no end at all — and that's exactly the practice
-- a Sunday email to parents most needs one for.
--
-- Called EXPECTED on purpose. It's a forecast for pickup, sent at the
-- start of the week; if it moves, a follow-up email says so. It isn't a
-- commitment the app should be enforcing.
--
-- When it's set it wins over the plan. A 90-minute plan is rarely a
-- 90-minute practice — there's a warm-up before the first block and a
-- talk after the last — and the coach typing a time is the one who knows
-- that. Unset, the end comes from the blocks; neither, and only the start
-- is shown.

alter table public.practices
  add column if not exists expected_end_time time;

comment on column public.practices.expected_end_time is
  'Coach-set expected end, for parents. Wins over the end computed from blocks when set. A forecast, not a commitment.';
