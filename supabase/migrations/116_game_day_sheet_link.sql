-- 116_game_day_sheet_link.sql
--
-- Lets a game point at the play sheet you're carrying to it.
--
-- The column goes on GAMES, not on the sheet, and that's the whole design.
-- A gameday_sheet has a name and no game_id because it's a reusable
-- artifact -- the same call sheet goes to ten games, and you might keep a
-- "Man" one and a "Zone" one. Putting the link here means many games can
-- reference one sheet, nothing is copied, and editing the sheet updates
-- every game that points at it.
--
-- Consequence worth knowing: because it's shared rather than snapshotted,
-- opening a game from last month shows the sheet as it is NOW, not as it
-- was that night. For a call sheet that's right -- the game report is the
-- record of what happened. If a frozen copy is ever wanted, duplicating
-- the sheet is the answer rather than making this link a copy.
--
-- ON DELETE SET NULL: deleting a sheet must not delete games.

alter table public.games
  add column if not exists gameday_sheet_id uuid references public.gameday_sheets(id) on delete set null;

create index if not exists games_gameday_sheet_idx on public.games(gameday_sheet_id);
