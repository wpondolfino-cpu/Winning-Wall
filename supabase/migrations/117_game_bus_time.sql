-- 117_game_bus_time.sql
--
-- Away games have two times that matter and they aren't the same: when the
-- bus leaves and when the ball goes up. Players who only know the tip time
-- miss the bus.
--
-- Separate from tip_time rather than folded into location text, so the
-- Schedule can show it as a time and lead with whichever one is the thing
-- you actually need to be somewhere for.
--
-- Nullable: home games usually have no bus, and an away game's bus time is
-- often set later than its tip time.

alter table public.games
  add column if not exists bus_time time;
