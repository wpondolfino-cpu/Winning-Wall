-- 101_report_game_groups.sql
-- Follow-on to 100_game_format.sql.
--
-- game_type made scrimmages and practices representable, but every report
-- still pulled every game in a season regardless of type -- so the first
-- tracked scrimmage would quietly land in season averages next to real
-- games. This adds the filter half of that feature.
--
-- Reports are now scoped to a game GROUP rather than a single type, so
-- "games" can mean regular season plus tournament plus playoff without
-- the coach having to tick three boxes:
--
--   games       -> regular, tournament, playoff   (real competition)
--   scrimmages  -> scrimmage                      (preseason, vs another school)
--   practices   -> practice                       (intrasquad sessions)
--   summer      -> summer                         (summer league)
--
-- Defaulting to 'games' means every saved report that already exists keeps
-- meaning exactly what it meant before, since every existing game row is
-- game_type 'regular'.
--
-- Idempotent -- safe to re-run.

alter table public.saved_reports
  add column if not exists game_group text not null default 'games';

alter table public.saved_reports drop constraint if exists saved_reports_game_group_check;
alter table public.saved_reports add constraint saved_reports_game_group_check
  check (game_group in ('games', 'scrimmages', 'practices', 'summer'));
