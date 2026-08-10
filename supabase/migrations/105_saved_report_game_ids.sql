-- 105_saved_report_game_ids.sql
-- Saved reports can now remember an arbitrary set of games.
--
-- game_count only ever expressed "3", "5", "10" or "season", which can't
-- describe "Mansfield, Franklin and Taunton". Rather than encode that into
-- the old column, an explicit list sits alongside it.
--
-- Both are kept. A report saved as "last 5" should still MEAN last 5 when
-- reopened in March -- it should pick up the five most recent games, not the
-- five that happened to be recent when it was saved. So a preset report
-- leaves game_ids null and stays relative; a hand-picked one stores its ids
-- and stays fixed. Which is right in each case, and neither can express the
-- other.
--
-- Idempotent -- safe to re-run.

alter table public.saved_reports
  add column if not exists game_ids uuid[];

comment on column public.saved_reports.game_ids is
  'Explicit game set for a hand-picked report. Null means the report is relative and re-resolves from game_count each time it is opened.';
