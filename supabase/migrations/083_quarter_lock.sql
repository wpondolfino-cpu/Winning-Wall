-- 083_quarter_lock.sql
-- A lighter, narrower version of the existing whole-game "finish ->
-- locked -> PossessionEditor only" pattern: a coach can close off a
-- single quarter mid-game so no new possessions get logged against it
-- by mistake once play has moved on, without needing the whole game
-- to be over. Mirrors that same escape-hatch shape too (reopen if
-- closed too early), just scoped to one quarter instead of the game.

alter table public.games
  add column if not exists closed_quarters int[] not null default '{}'::int[];
