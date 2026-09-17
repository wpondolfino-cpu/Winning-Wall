-- 134_possession_looks.sql
--
-- Records every LOOK in a trip, not just how the trip ended.
--
-- A trip (one possession) is one or more looks. A new look starts when an
-- offensive rebound keeps the trip alive, a BLOB/SLOB flows into a
-- half-court set, a press break turns into transition or a half-court look
-- (or our press on defence falls back into man/zone), or a foul/jump/OOB
-- turns the trip into an inbounds play.
--
-- Until now the tracker cleared everything about a look when a rebound
-- happened -- paint touch, structure, play call, shot quality -- so a trip
-- only described what happened after its last rebound, and a BLOB that
-- flowed into a set couldn't be told apart from the set itself.
--
-- looks: the trip's looks in order, as JSON (see the Look type in
-- src/lib/gameStats.ts). Each look carries its own type, half-court
-- structure, play call, paint touch, result, shot grade and points. The
-- existing columns stay and are written as a summary of the looks, so
-- per-possession stats (PPP, possessions, TOV%, OREB%, shooting) read
-- them exactly as before. Null on rows tracked before this migration --
-- the app works their looks out from the old columns.
--
-- live_ft_misses: how many times the LAST free throw was missed with the
-- ball live, whoever got the rebound. OREB% now counts these as rebound
-- chances; offensive rebounds of free throws were already in oreb_count,
-- so until now they were counted on top of the fraction but not below it.
--
-- Stored on the possession row, not a child table, so a trip still saves
-- as one write: the tracker's offline queue can never leave half a trip
-- behind.
--
-- RUN THIS BEFORE DEPLOYING THE APP CHANGE. The tracker sends both columns
-- with every possession; without them every save fails and possessions
-- pile up in the offline queue until the columns exist.
--
-- No backfill: earlier rows keep looks = null and live_ft_misses = 0.

alter table public.possessions
  add column if not exists looks jsonb,
  add column if not exists live_ft_misses int not null default 0;

alter table public.possessions
  drop constraint if exists possessions_looks_is_array;
alter table public.possessions
  add constraint possessions_looks_is_array
  check (looks is null or jsonb_typeof(looks) = 'array');

alter table public.possessions
  drop constraint if exists possessions_live_ft_misses_nonneg;
alter table public.possessions
  add constraint possessions_live_ft_misses_nonneg
  check (live_ft_misses >= 0);
