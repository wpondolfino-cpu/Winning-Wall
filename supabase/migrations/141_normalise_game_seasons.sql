-- 141_normalise_game_seasons.sql
--
-- Gives every game the same kind of season label.
--
-- Games were created in four places, each labelling the season its own
-- way:
--   · the game tracker — school year from the date:   "2026-2027"
--   · the scout hub and scout import — calendar year: "2026", or "2027"
--     for a January game in the same season
--   · the schedule import — the practice season's name: "2025-26"
-- Reports group games by this label, so one season's games could be split
-- across three of them.
--
-- Everything now goes through createGame, which uses the school-year rule,
-- so no new game can be mislabelled. This brings the existing ones into
-- line: August onwards starts a new season.
--
-- It rewrites a label from the game's own date and touches nothing else.
-- A game already labelled correctly is left alone.
--
-- To see what it will change before running it:
--
--   select game_date, opponent, season as now,
--     case when extract(month from game_date) >= 8
--       then extract(year from game_date)::int || '-' || (extract(year from game_date)::int + 1)
--       else (extract(year from game_date)::int - 1) || '-' || extract(year from game_date)::int
--     end as becomes
--   from public.games
--   where season is distinct from (case when extract(month from game_date) >= 8
--       then extract(year from game_date)::int || '-' || (extract(year from game_date)::int + 1)
--       else (extract(year from game_date)::int - 1) || '-' || extract(year from game_date)::int end)
--   order by game_date;

update public.games
   set season = case
     when extract(month from game_date) >= 8
       then extract(year from game_date)::int || '-' || (extract(year from game_date)::int + 1)
     else (extract(year from game_date)::int - 1) || '-' || extract(year from game_date)::int
   end
 where game_date is not null
   and season is distinct from (case
     when extract(month from game_date) >= 8
       then extract(year from game_date)::int || '-' || (extract(year from game_date)::int + 1)
     else (extract(year from game_date)::int - 1) || '-' || extract(year from game_date)::int
   end);
