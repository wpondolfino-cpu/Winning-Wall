-- ============================================================
-- 210_loose_scout_sheets_and_scout_teams.sql
--
-- Two small changes for the Scouting calendar.
--
-- 1. A scout sheet doesn't have to belong to one of our games.
--    Scouting a possible playoff opponent we don't play (yet) makes a
--    sheet with no game. If we end up playing them, the app attaches that
--    sheet to the game instead of starting a blank one. Sheets that do
--    belong to a game are unchanged (still one per game).
--
-- 2. Each scout on the calendar can say which team they're watching
--    ("Coach Oliver · Oliver Ames"). It's a label only: any coach can
--    still open and edit any sheet. Empty = both teams / not set.
--
-- No data changes; nothing is removed. Safe to run more than once.
-- ============================================================

begin;

-- 1. Sheets without a game (no-op if game_id already allows it).
alter table public.scout_sheets alter column game_id drop not null;

-- Finding an opponent's game-less sheet is a quick lookup.
create index if not exists scout_sheets_loose_idx
  on public.scout_sheets (opponent_id) where game_id is null;

-- 2. Which team each scout is watching.
alter table public.scouting_assignments add column if not exists sheet_team text
  check (sheet_team is null or length(sheet_team) <= 80);

commit;

-- Check: both should say YES.
select
  (select case when is_nullable = 'YES' then 'YES' else 'NO' end
     from information_schema.columns
    where table_schema = 'public' and table_name = 'scout_sheets' and column_name = 'game_id') as sheets_can_skip_game,
  (select case when count(*) = 1 then 'YES' else 'NO' end
     from information_schema.columns
    where table_schema = 'public' and table_name = 'scouting_assignments' and column_name = 'sheet_team') as scouts_have_team;
