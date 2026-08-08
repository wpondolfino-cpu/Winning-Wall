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

-- period_lengths holds the minutes of EVERY period in order, regulation
-- first then any overtime -- e.g. [8,8,8,8,4] for a game that went to OT.
-- Its length is the period count, so there's no separate overtime_periods
-- to keep in sync with it.
--
-- Games (quarters/halves) fill it with one typed value and don't allow
-- per-period edits; scrimmages and practices do, because a practice
-- genuinely runs uneven blocks (10, 10, 6, 12) while a basketball game
-- does not. Same column either way -- only the UI differs.
--
-- ot_minutes is just the default length used when "+ OT" is pressed, so
-- adding an overtime courtside is one tap with no prompt.
alter table public.games
  add column if not exists period_format     text  not null default 'quarters',
  add column if not exists regulation_periods int   not null default 4,
  add column if not exists period_lengths     int[] not null default '{8,8,8,8}'::int[],
  add column if not exists ot_minutes         int   not null default 4,
  add column if not exists game_type          text  not null default 'regular';

-- Superseded by period_lengths.
alter table public.games drop column if exists period_minutes;
alter table public.games drop column if exists overtime_periods;

alter table public.games drop constraint if exists games_period_format_check;
alter table public.games add constraint games_period_format_check
  check (period_format in ('quarters', 'halves', 'periods', 'sessions'));

-- Up to 8 rather than 4: a preseason scrimmage is commonly 5-6 running
-- periods, and a practice can hold several intrasquad sessions. Those
-- are full-length periods, not overtimes -- calling them OT would also
-- make the minutes estimator use ot_minutes for them.
alter table public.games drop constraint if exists games_regulation_periods_check;
alter table public.games add constraint games_regulation_periods_check
  check (regulation_periods between 1 and 8);

alter table public.games drop constraint if exists games_ot_minutes_check;
alter table public.games add constraint games_ot_minutes_check
  check (ot_minutes between 1 and 15);

-- Total periods tops out at 12 to match the possessions.quarter ceiling
-- below, and every period needs a sane length.
alter table public.games drop constraint if exists games_period_lengths_check;
alter table public.games add constraint games_period_lengths_check
  check (
    array_length(period_lengths, 1) between 1 and 12
    and array_length(period_lengths, 1) >= regulation_periods
  );

-- 'tournament' and 'playoff' were split originally but behaved
-- identically everywhere (both just rolled into the Games report group),
-- so they're folded into a single 'postseason'. The update runs before the
-- constraint so any rows already using the old values convert cleanly.
update public.games set game_type = 'postseason' where game_type in ('tournament', 'playoff');

alter table public.games drop constraint if exists games_game_type_check;
alter table public.games add constraint games_game_type_check
  check (game_type in ('regular', 'postseason', 'summer', 'scrimmage', 'practice'));

-- possessions.quarter is really "period number" -- regulation periods
-- first, then overtimes. The old ceiling of 8 was fine for 4 quarters
-- plus 4 OTs; 12 leaves headroom without meaning anything different.
alter table public.possessions drop constraint if exists possessions_quarter_check;
alter table public.possessions add constraint possessions_quarter_check
  check (quarter between 1 and 12);

create index if not exists games_game_type_idx on public.games(game_type);
