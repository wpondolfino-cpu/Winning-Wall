-- ============================================================
-- 211_practice_water_and_film.sql
--
-- Two markers in the practice builder:
--   practice_blocks.water_break -- 💧 a water break after this block
--   segment_drills.film         -- 🎥 film this drill
-- Markers only: neither takes any minutes. Both start off for every
-- existing practice and template. Coaches, the print view and players
-- see them when they're on.
--
-- No data changes; nothing removed. Safe to run more than once.
-- ============================================================

begin;

alter table public.practice_blocks add column if not exists water_break boolean not null default false;
alter table public.segment_drills  add column if not exists film        boolean not null default false;

commit;

-- Check: should say 2.
select count(*) as new_columns
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'practice_blocks' and column_name = 'water_break')
     or (table_name = 'segment_drills'  and column_name = 'film'));
