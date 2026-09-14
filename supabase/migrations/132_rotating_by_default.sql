-- 132_rotating_by_default.sql
--
-- Stations rotate by default.
--
-- 'fixed' was the safe default when rotation didn't exist yet — it
-- matched the only behaviour there was. Now that both exist, rotating is
-- what most station blocks actually are: bigs-and-guards is the exception,
-- four groups moving between four baskets is the rule.
--
-- Only affects blocks created from here on. A block that already has
-- people assigned to stations keeps its stored 'fixed', because the
-- default is applied on insert and never retrospectively.

alter table public.practice_blocks
  alter column station_mode set default 'rotating';
