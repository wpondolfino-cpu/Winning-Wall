-- ============================================================
-- 180_scope_practices.sql
--
-- MULTI-TENANCY STEP 6 — practices, schedule, tryouts, Team Designer.
--
-- Fenced to their program (same restrictive "program_scope" rule as
-- plays): practice weeks & practices (blocks, segments, drills, groups,
-- rotations, attendance), the team drill library with its categories and
-- tags, saved groupings, Practice Wins, practice cover items, schedule
-- events, tryout pool & attendance, and Team Designer plans/lanes/slots/
-- positions.
--
-- Also:
--   * Drill categories and tags are keyed per program; Girls gets a copy
--     of Boys' category and tag NAMES (not drills) to start from.
--   * Three tryout / Team Designer functions that run with elevated
--     rights now only touch the program you're in ("clear tryout pool"
--     could otherwise have cleared every program's pool).
--
-- Ships with one app file: src/lib/practicePlanner.ts (tag save).
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Drill categories & tags: one list per program ──────────

-- Categories: practice_drills_library.category_name -> (program, name).
-- Deleting a category clears it from drills (only the name column).
alter table public.practice_drills_library drop constraint if exists practice_drills_library_category_name_fkey;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'practice_drill_categories_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (name)') then
    alter table public.practice_drill_categories drop constraint practice_drill_categories_pkey;
    alter table public.practice_drill_categories add constraint practice_drill_categories_pkey primary key (program_id, name);
  end if;
end $$;
alter table public.practice_drills_library
  add constraint practice_drills_library_category_name_fkey
  foreign key (program_id, category_name) references public.practice_drill_categories (program_id, name)
  on update cascade on delete set null (category_name);

-- Tags: practice_drill_tag_links.tag_name -> (program, name).
alter table public.practice_drill_tag_links drop constraint if exists practice_drill_tag_links_tag_name_fkey;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'practice_drill_tags_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (name)') then
    alter table public.practice_drill_tags drop constraint practice_drill_tags_pkey;
    alter table public.practice_drill_tags add constraint practice_drill_tags_pkey primary key (program_id, name);
  end if;
end $$;
alter table public.practice_drill_tag_links
  add constraint practice_drill_tag_links_tag_name_fkey
  foreign key (program_id, tag_name) references public.practice_drill_tags (program_id, name)
  on update cascade on delete cascade;

-- Girls starts with Boys' category and tag names.
insert into public.practice_drill_categories (program_id, name, sort_order)
select g.id, c.name, c.sort_order
from public.practice_drill_categories c
join public.programs b on b.id = c.program_id and b.name = 'Boys Basketball'
cross join (select pr.id from public.programs pr join public.organizations o on o.id = pr.organization_id
            where o.name = 'Attleboro High School' and pr.name = 'Girls Basketball') g
on conflict (program_id, name) do nothing;

insert into public.practice_drill_tags (program_id, name)
select g.id, t.name
from public.practice_drill_tags t
join public.programs b on b.id = t.program_id and b.name = 'Boys Basketball'
cross join (select pr.id from public.programs pr join public.organizations o on o.id = pr.organization_id
            where o.name = 'Attleboro High School' and pr.name = 'Girls Basketball') g
on conflict (program_id, name) do nothing;


-- ── 2. The program fence ──────────────────────────────────────
select public.add_program_scope(t) from unnest(array[
  'practice_weeks',
  'practices',
  'practice_blocks',
  'block_segments',
  'segment_drills',
  'segment_drill_groups',
  'segment_drill_group_members',
  'block_rotation_groups',
  'practice_attendance_overrides',
  'practice_drills_library',
  'practice_drill_categories',
  'practice_drill_tags',
  'practice_drill_tag_links',
  'saved_groupings',
  'saved_grouping_members',
  'practice_wins',
  'practice_cover_items',
  'schedule_events',
  'tryout_players',
  'tryout_attendance',
  'team_plans',
  'team_plan_lanes',
  'team_plan_slots',
  'team_positions'
]) as t;


-- ── 3. Elevated-rights functions: stay inside your program ────
create or replace function public.clear_tryout_pool_unguarded(p_season_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.tryout_players
  where season_id is not distinct from p_season_id
    and program_id = public.current_program_id();
end;
$$;

create or replace function public.cut_tryout_players_not_in_plan_unguarded(p_plan_id uuid)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pid     uuid := public.current_program_id();
  v_season  uuid;
  v_deleted integer;
begin
  select season_id into v_season from public.team_plans where id = p_plan_id and program_id = v_pid;
  if not found then raise exception 'That plan isn''t in your program'; end if;

  with kept as (
    select tryout_player_id from public.team_plan_slots
    where plan_id = p_plan_id and zone = 'lane' and tryout_player_id is not null
  )
  delete from public.tryout_players t
  where t.program_id = v_pid
    and t.season_id is not distinct from v_season
    and t.id not in (select tryout_player_id from kept);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.duplicate_team_plan_unguarded(p_plan_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_new_plan uuid;
  v_lane     record;
  v_lane_map jsonb := '{}'::jsonb;
  v_new_lane uuid;
begin
  if not exists (select 1 from public.team_plans where id = p_plan_id and program_id = public.current_program_id()) then
    raise exception 'That plan isn''t in your program';
  end if;

  insert into public.team_plans (season_id, name, created_by)
  select season_id, p_name, auth.uid() from public.team_plans where id = p_plan_id
  returning id into v_new_plan;

  for v_lane in select * from public.team_plan_lanes where plan_id = p_plan_id order by order_index loop
    insert into public.team_plan_lanes (plan_id, name, order_index)
    values (v_new_plan, v_lane.name, v_lane.order_index)
    returning id into v_new_lane;
    v_lane_map := v_lane_map || jsonb_build_object(v_lane.id::text, v_new_lane::text);
  end loop;

  insert into public.team_plan_slots
    (plan_id, zone, lane_id, position_id, rank, display_name, profile_id, tryout_player_id)
  select
    v_new_plan, s.zone,
    case when s.lane_id is null then null else (v_lane_map ->> s.lane_id::text)::uuid end,
    s.position_id, s.rank, s.display_name, s.profile_id, s.tryout_player_id
  from public.team_plan_slots s
  where s.plan_id = p_plan_id;

  return v_new_plan;
end;
$$;

commit;


-- ── Summary ───────────────────────────────────────────────────
select 'tables fenced to their program' as item,
       count(*)::text || ' tables' as value
from pg_policies where policyname = 'program_scope' and permissive = 'RESTRICTIVE'
union all
select 'practice tables fenced (expect 24)',
       count(*)::text from pg_policies
where policyname = 'program_scope' and tablename in ('practice_weeks', 'practices', 'practice_blocks', 'block_segments', 'segment_drills', 'segment_drill_groups', 'segment_drill_group_members', 'block_rotation_groups', 'practice_attendance_overrides', 'practice_drills_library', 'practice_drill_categories', 'practice_drill_tags', 'practice_drill_tag_links', 'saved_groupings', 'saved_grouping_members', 'practice_wins', 'practice_cover_items', 'schedule_events', 'tryout_players', 'tryout_attendance', 'team_plans', 'team_plan_lanes', 'team_plan_slots', 'team_positions')
union all
select 'drill categories / tags per program',
       (select string_agg(pr.name || ': ' || c || ' / ' || t, ' | ' order by pr.name)
          from public.programs pr
          cross join lateral (select count(*)::text c from public.practice_drill_categories where program_id = pr.id) cc
          cross join lateral (select count(*)::text t from public.practice_drill_tags where program_id = pr.id) tt)
union all
select 'Boys practices', (select count(*)::text from public.practices p join public.programs pr on pr.id = p.program_id where pr.name = 'Boys Basketball');
