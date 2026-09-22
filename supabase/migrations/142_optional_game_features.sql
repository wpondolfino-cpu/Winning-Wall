-- 142_optional_game_features.sql
--
-- Not every game gets the full treatment.
--
-- Varsity games are tracked possession by possession, scouted and run off
-- a play sheet. A freshman game usually isn't — but it still belongs on
-- the freshman schedule, and it still has a final score. Until now every
-- game carried every feature, so a freshman schedule showed a faded Scout
-- sheet and Play sheet link on every row, and every freshman game sat in
-- the tracker waiting to be tracked.
--
-- Three switches per game:
--   track_stats      — in the tracker and in reports. Off, the game drops
--                      out of both, and its score is typed on the schedule.
--   uses_scout_sheet — the schedule row offers a scout sheet.
--   uses_play_sheet  — the schedule row offers a play sheet.
--
-- An untracked game doesn't count in reports at all — not its score, not
-- as a game played, not toward a record. Every report is built only from
-- games you actually tracked.
--
-- All default to on, so every existing game behaves exactly as before.
-- Switching tracking on later is fine; the game simply starts appearing in
-- the tracker.

alter table public.games
  add column if not exists track_stats boolean not null default true;
alter table public.games
  add column if not exists uses_scout_sheet boolean not null default true;
alter table public.games
  add column if not exists uses_play_sheet boolean not null default true;

-- Reports and the tracker only ever ask for tracked games.
create index if not exists games_tracked_idx
  on public.games(game_date desc) where track_stats;
