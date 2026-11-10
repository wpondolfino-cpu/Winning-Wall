-- 207_remove_blank_scout_sheets.sql
-- Removes scout sheets left behind on games whose "Scout sheet" box was
-- unticked (e.g. the JV games from the schedule import), but ONLY sheets
-- with nothing written on them: no players, sets, specials, defense,
-- keys, strengths, record, tempo or quiz. A sheet with any scouting on it
-- is kept -- delete those from the opponent page if you mean to.
-- From now on the app does this itself when you untick Scout sheet.
-- Safe to run again.

begin;

create temp table _blank on commit drop as
select s.id, s.game_id, s.program_id
  from public.scout_sheets s
  join public.games g on g.id = s.game_id
 where g.uses_scout_sheet = false
   and coalesce(trim(s.team_record), '') = '' and coalesce(trim(s.tempo), '') = ''
   and not exists (select 1 from unnest(coalesce(s.keys_to_game, '{}')) k where trim(k) <> '')
   and not exists (select 1 from unnest(coalesce(s.team_offensive_strengths, '{}')) k where trim(k) <> '')
   and not exists (select 1 from public.scout_players      x where x.scout_sheet_id = s.id)
   and not exists (select 1 from public.scout_offense_sets x where x.scout_sheet_id = s.id)
   and not exists (select 1 from public.scout_specials     x where x.scout_sheet_id = s.id)
   and not exists (select 1 from public.scout_defense      x where x.scout_sheet_id = s.id)
   and not exists (select 1 from public.quizzes            x where x.scout_sheet_id = s.id);

delete from public.scout_sheets s using _blank b where s.id = b.id;

-- What was removed (empty = nothing to do).
select p.name as program, g.game_date, g.opponent
  from _blank b
  join public.games g on g.id = b.game_id
  left join public.programs p on p.id = b.program_id
 order by 1, 2;

commit;

-- Sheets kept because they have scouting on them, on games with Scout sheet off.
select g.game_date, g.opponent, s.status
  from public.scout_sheets s join public.games g on g.id = s.game_id
 where g.uses_scout_sheet = false
 order by 1;
