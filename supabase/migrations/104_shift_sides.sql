-- 104_shift_sides.sql
-- Phase 1.5: intrasquad practices, where both teams are yours.
--
-- A game has one five worth tracking -- ours. A practice scrimmage has two,
-- and every possession is offence for one of your lineups and defence for
-- another. So a shift now records which SIDE it belongs to, and possessions
-- are credited to two shifts instead of one.
--
-- The clean part: one assignment rule covers both cases. A possession's
-- offence goes to the latest shift whose side matches the team with the
-- ball, and its defence to the latest shift on the other side. For a game,
-- where only 'us' shifts exist, the defensive lookup on our own possessions
-- simply finds nothing -- which is exactly the existing behaviour. Nothing
-- about game tracking changes.
--
-- Sides are 'us' and 'opponent' to match possessions.team, and surface as
-- "Team 1" and "Team 2" in a practice. Deliberately not coach-editable
-- names: the labels change every session, and a lineup is identified by its
-- five players anyway, so a per-session name would be one more thing to
-- enter for no analytical gain.

alter table public.shifts
  add column if not exists side text not null default 'us';

alter table public.shifts drop constraint if exists shifts_side_check;
alter table public.shifts add constraint shifts_side_check
  check (side in ('us', 'opponent'));

-- Two shifts can now start at the same possession -- one per side -- so the
-- old uniqueness on (game_id, start_sequence) has to include the side.
alter table public.shifts drop constraint if exists shifts_game_seq_unique;
alter table public.shifts drop constraint if exists shifts_game_seq_side_unique;
alter table public.shifts add constraint shifts_game_seq_side_unique
  unique (game_id, start_sequence, side);

drop index if exists shifts_game_idx;
create index if not exists shifts_game_side_idx on public.shifts(game_id, side, start_sequence);
