-- 145_saved_groupings_by_season.sql
--
-- A saved grouping belongs to the season it was saved in.
--
-- Varsity is a permanent roster, so "3s Week 1" from last year sat in the
-- picker next to this year's, full of names that have graduated. Nothing
-- is deleted automatically: the picker shows this season's by default,
-- older ones sit behind a toggle, and starting a new season offers a
-- one-tap delete with the count shown.
--
-- Practices that used an arrangement are unaffected either way. Loading
-- one SNAPSHOTS it into segment_drill_groups, and the source link there
-- is on delete set null.

alter table public.saved_groupings
  add column if not exists season_id uuid references public.seasons(id) on delete set null;

create index if not exists saved_groupings_season_idx
  on public.saved_groupings(season_id);

-- Existing ones go to whichever season was running when they were made.
update public.saved_groupings
   set season_id = public.season_for_date(created_at::date)
 where season_id is null;

-- New ones file under the current season without the client having to
-- pass it, so every insert path (there are two) is covered.
create or replace function public.saved_groupings_set_season()
returns trigger
language plpgsql
as $$
begin
  if new.season_id is null then
    new.season_id := coalesce(
      (select id from public.seasons where is_current limit 1),
      public.season_for_date(current_date)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists saved_groupings_set_season on public.saved_groupings;
create trigger saved_groupings_set_season
  before insert on public.saved_groupings
  for each row execute function public.saved_groupings_set_season();

-- Names were unique per roster forever, so this year's "3s Week 1" would
-- have been refused because last year's exists. Unique per roster per
-- season instead.
alter table public.saved_groupings
  drop constraint if exists saved_groupings_name_roster_id_key;

create unique index if not exists saved_groupings_name_roster_season_key
  on public.saved_groupings(roster_id, name, coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid));
