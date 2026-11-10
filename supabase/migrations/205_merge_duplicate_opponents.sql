-- 205_merge_duplicate_opponents.sql
-- Merges opponents that are the same team listed twice in one program
-- (e.g. two "Franklin"s made when a schedule was imported).
--
-- Same name = same team, ignoring capitals and extra spaces, within one
-- program only (Boys' Franklin and Girls' Franklin stay separate). For
-- each set, the oldest one is kept; its games and scout sheets get every
-- game and scout sheet from the duplicates, a logo is carried over if the
-- kept one has none, then the duplicates are deleted.
-- Safe to run again (the second run finds nothing to merge).

begin;

create temp table _opp_merge on commit drop as
select o.id as dup_id, k.keep_id, o.program_id, o.name
  from public.opponents o
  join lateral (
    select x.id as keep_id from public.opponents x
     where x.program_id = o.program_id
       and lower(regexp_replace(trim(x.name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(o.name), '\s+', ' ', 'g'))
     order by x.created_at, x.id
     limit 1) k on true
 where o.id <> k.keep_id;

-- Logo: keep the kept one's; otherwise take a duplicate's.
update public.opponents k
   set logo_url = d.logo_url
  from (select distinct on (m.keep_id) m.keep_id, o.logo_url
          from _opp_merge m join public.opponents o on o.id = m.dup_id
         where o.logo_url is not null
         order by m.keep_id, o.created_at) d
 where k.id = d.keep_id and k.logo_url is null;

update public.games g set opponent_id = m.keep_id, opponent = k.name
  from _opp_merge m join public.opponents k on k.id = m.keep_id
 where g.opponent_id = m.dup_id;
update public.scout_sheets s set opponent_id = m.keep_id
  from _opp_merge m where s.opponent_id = m.dup_id;

delete from public.opponents o using _opp_merge m where o.id = m.dup_id;

-- What was merged (empty = nothing to do).
select p.name as program, m.name as team, count(*) as duplicates_merged
  from _opp_merge m join public.programs p on p.id = m.program_id
 group by p.name, m.name
 order by 1, 2;

commit;
