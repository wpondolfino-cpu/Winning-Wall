-- 125_practice_weeks_sunday_start.sql
--
-- Three fixes to how practice weeks are created and found.
--
-- 1. Weeks run Sunday to Saturday. The first practice of a basketball
--    week is usually Sunday, and a Monday start split it from the rest of
--    the week it belongs to.
--
-- 2. A week auto-created by week_for_date now inherits the season it was
--    asked for. It was being called with a null season, and the practices
--    page only renders weeks belonging to the season you're viewing — so
--    every auto-created week was invisible from birth, taking its
--    practices with it.
--
-- 3. Deleting a week no longer strands its practices. week_id was
--    "on delete set null", which left them alive with no week — and every
--    listing path filters by week, so they became unreachable. The app now
--    asks what to do with them, and this makes the database agree: a week
--    can't be deleted while practices point at it.

-- ── Sunday-Saturday, and inherit the season ──────────────────
create or replace function public.week_for_date(p_date date, p_season_id uuid default null)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_start date;
  v_end date;
begin
  select id into v_id from public.practice_weeks
   where start_date is not null and end_date is not null
     and p_date between start_date and end_date
   order by start_date desc limit 1;
  if v_id is not null then return v_id; end if;

  -- Sunday-Saturday. extract(dow) is 0 on Sunday, so subtracting it
  -- lands on the Sunday of that week.
  v_start := p_date - extract(dow from p_date)::int;
  v_end   := v_start + 6;

  insert into public.practice_weeks (name, season_id, start_date, end_date)
  values (
    to_char(v_start, 'Mon DD') || ' - ' || to_char(v_end, 'Mon DD'),
    -- Fall back to the current season rather than null: a seasonless week
    -- renders nowhere.
    coalesce(p_season_id, (select id from public.seasons where is_current order by created_at desc limit 1)),
    v_start, v_end
  )
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.week_for_date(date, uuid) to authenticated;

-- ── Adopt the weeks that were born seasonless ────────────────
-- Seasons are just a name and an is_current flag — they carry no date
-- range — so there's nothing to match a week's dates against. The current
-- season is the only sensible home. Without this they stay invisible and
-- so do their practices.
update public.practice_weeks
   set season_id = (select id from public.seasons where is_current order by created_at desc limit 1)
 where season_id is null
   and exists (select 1 from public.seasons where is_current);

-- ── Shift existing Monday-start weeks to Sunday ──────────────
-- Only the ones that are exactly a Monday-Sunday span, so a week whose
-- dates were widened by hand is left alone. Doing this now avoids two
-- weeks overlapping on the same Monday during the changeover.
update public.practice_weeks
   set start_date = start_date - 1,
       end_date   = end_date - 1
 where start_date is not null and end_date is not null
   and extract(dow from start_date) = 1
   and end_date = start_date + 6;

-- ── Stop deleting a week from stranding its practices ────────
alter table public.practices
  drop constraint if exists practices_week_id_fkey;

alter table public.practices
  add constraint practices_week_id_fkey
  foreign key (week_id) references public.practice_weeks(id)
  on delete restrict;
