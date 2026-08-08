-- 100_game_format.sql
-- Phase 0 of the lineup tracker work, but useful on its own.
--
-- Two real bugs this fixes:
--   1. Halves were faked by tracking only Q1/Q2 and ending the game, but
--      GameReport hardcodes half 1 = quarters [1,2] and half 2 = [3,4].
--      So on a halves game the "Halftime" report returned the WHOLE game
--      and "2nd half" returned nothing.
--   2. The quarter tab row was hardcoded to [1,2,3,4], so there was no
--      way to log an overtime at all -- even though possessions.quarter
--      already allowed up to 8.
--
-- Period structure now lives on the game row and everything derives from
-- it. The defaults reproduce the old hardcoded behaviour exactly (4 x 8
-- minute quarters), so every existing game keeps behaving identically and
-- nothing needs backfilling. A summer-league game just gets its format
-- flipped to halves and its already-tracked Q1/Q2 data is correct as-is --
-- those were always periods 1 and 2, the app was only mislabelling them.
--
-- game_type is here rather than in a later migration because it's what
-- makes scrimmage/summer tracking a filter instead of a subsystem: a
-- scrimmage is just a game row with a different type. 'scrimmage' means
-- against another school; 'practice' means intrasquad. They're separate
-- values because those are genuinely different data (see below), and
-- re-tagging games after the fact would be manual work.
--
-- This file is idempotent -- every statement is add-if-not-exists or
-- drop-constraint-if-exists -- so it's safe to re-run.

alter table public.games
  add column if not exists period_format     text not null default 'quarters',
  add column if not exists regulation_periods int  not null default 4,
  add column if not exists period_minutes     int  not null default 8,
  add column if not exists ot_minutes         int  not null default 4,
  add column if not exists overtime_periods   int  not null default 0,
  add column if not exists game_type          text not null default 'regular';

alter table public.games drop constraint if exists games_period_format_check;
alter table public.games add constraint games_period_format_check
  check (period_format in ('quarters', 'halves'));

alter table public.games drop constraint if exists games_regulation_periods_check;
alter table public.games add constraint games_regulation_periods_check
  check (regulation_periods between 1 and 4);

alter table public.games drop constraint if exists games_period_minutes_check;
alter table public.games add constraint games_period_minutes_check
  check (period_minutes between 1 and 30);

alter table public.games drop constraint if exists games_ot_minutes_check;
alter table public.games add constraint games_ot_minutes_check
  check (ot_minutes between 1 and 15);

-- Capped at 8 so a 4-quarter game tops out at period 12, which matches
-- the possessions.quarter ceiling below.
alter table public.games drop constraint if exists games_overtime_periods_check;
alter table public.games add constraint games_overtime_periods_check
  check (overtime_periods between 0 and 8);

alter table public.games drop constraint if exists games_game_type_check;
alter table public.games add constraint games_game_type_check
  check (game_type in ('regular', 'scrimmage', 'summer', 'tournament', 'playoff', 'practice'));

-- possessions.quarter is really "period number" -- regulation periods
-- first, then overtimes. The old ceiling of 8 was fine for 4 quarters
-- plus 4 OTs; 12 leaves headroom without meaning anything different.
alter table public.possessions drop constraint if exists possessions_quarter_check;
alter table public.possessions add constraint possessions_quarter_check
  check (quarter between 1 and 12);

create index if not exists games_game_type_idx on public.games(game_type);
