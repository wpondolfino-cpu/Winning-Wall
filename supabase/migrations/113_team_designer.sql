-- 113_team_designer.sql
--
-- The Team Designer: a coach's planning board. Named plans, each holding
-- a stacked depth chart across editable team lanes and editable position
-- columns, drawn from the tryout pool, the roster, or both.
--
-- IT NEVER WRITES TO ROSTERS. Rosters stay built by hand. This is the
-- plan; the roster is the record. Keeping them separate is what lets the
-- board hold people who don't have accounts yet, and lets a plan be
-- rearranged without changing who's actually on a team.
--
-- NAMED PLANS RATHER THAN A PROJECTION MODE
--
-- The first design had a clone-vs-live-view choice for projecting next
-- year. That dissolved once summer league came up: summer teams are a
-- second board existing at the same time as the depth chart, so multiple
-- plans are needed regardless. Once plans are named and duplicable,
-- "projection" is just a plan you duplicated, and "hide the seniors" is a
-- display toggle rather than a plan type. No is_projection flag.
--
-- SLOTS SURVIVE THEIR SOURCE
--
-- Every slot stores display_name as a snapshot alongside its reference.
-- A tryout reference is ON DELETE SET NULL (not cascade, unlike practice
-- groups): clearing the tryout pool after cuts must not gut the depth
-- chart. The name stays; only the link goes.

-- ── graduation year ───────────────────────────────────────────
-- Stored instead of a grade, because a stored grade is wrong every June
-- and would need a bulk update annually forever. Grade and alumni status
-- are derived from this against the current year.
--
-- grade_category is deliberately left alone. It's snapshotted as TEXT
-- into hall_of_fame and season_history rows, so changing its values would
-- retroactively relabel seasons that were already won. It stays the
-- leaderboard grouping key and can be derived from this column.
alter table public.profiles
  add column if not exists graduation_year int;

-- ── tryout pool additions ─────────────────────────────────────
alter table public.tryout_players
  add column if not exists grade int check (grade is null or grade between 5 and 12);

-- Which tryout they attended. Derived from grade on entry but stored
-- explicitly and editable, because the case that matters is the exception
-- -- a freshman pulled up to the varsity tryout.
alter table public.tryout_players
  add column if not exists tryout_group text
  check (tryout_group is null or tryout_group in ('upper', 'freshman'));

-- Set once a tryout name is matched to a real account. Linking lives here
-- rather than on the slot so one action covers every plan the person
-- appears in.
alter table public.tryout_players
  add column if not exists linked_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists tryout_players_linked_idx on public.tryout_players(linked_profile_id);

-- ── positions ─────────────────────────────────────────────────
-- Program-wide and editable rather than hardcoded. Ball handler / combo
-- guard / wing / big wing / big is one coach's vocabulary; a college
-- program will use different labels.
create table if not exists public.team_positions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  order_index int not null default 0,
  created_at  timestamptz not null default now()
);

-- ── plans ─────────────────────────────────────────────────────
create table if not exists public.team_plans (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid references public.seasons(id) on delete set null,
  name        text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists team_plans_season_idx on public.team_plans(season_id);

-- Lanes are per-plan, so a summer league plan can have "Gold / Blue"
-- while the depth chart has "Varsity / JV / Freshman".
create table if not exists public.team_plan_lanes (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.team_plans(id) on delete cascade,
  name        text not null,
  order_index int not null default 0
);

create index if not exists team_plan_lanes_plan_idx on public.team_plan_lanes(plan_id, order_index);

-- ── slots ─────────────────────────────────────────────────────
create table if not exists public.team_plan_slots (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.team_plans(id) on delete cascade,

  -- Where the card sits. 'lane' is a real team placement and needs both
  -- lane_id and position_id. 'bubble' and 'unplaced' are working areas
  -- below the board, so both are null there.
  zone          text not null default 'unplaced' check (zone in ('lane', 'bubble', 'unplaced')),
  lane_id       uuid references public.team_plan_lanes(id) on delete cascade,
  position_id   uuid references public.team_positions(id) on delete set null,
  rank          int not null default 0,

  -- Snapshot, always present. This is what makes a slot outlive its
  -- source -- clear the tryout pool and the card keeps its name.
  display_name  text not null,

  profile_id        uuid references public.profiles(id) on delete set null,
  tryout_player_id  uuid references public.tryout_players(id) on delete set null,

  created_at    timestamptz not null default now()
);

-- A slot in a lane must know which lane and which column.
alter table public.team_plan_slots drop constraint if exists team_plan_slots_lane_complete;
alter table public.team_plan_slots add constraint team_plan_slots_lane_complete
  check (zone <> 'lane' or (lane_id is not null and position_id is not null));

-- No player on two teams within one plan. Partial indexes because a slot
-- carries only one of the two references, and because a name-only slot
-- (both null, after the pool is cleared) must stay allowed.
create unique index if not exists team_plan_slots_profile_uniq
  on public.team_plan_slots(plan_id, profile_id) where profile_id is not null;
create unique index if not exists team_plan_slots_tryout_uniq
  on public.team_plan_slots(plan_id, tryout_player_id) where tryout_player_id is not null;

create index if not exists team_plan_slots_plan_idx on public.team_plan_slots(plan_id, zone, lane_id, position_id, rank);

-- ── cuts ──────────────────────────────────────────────────────
-- "Remove everyone who didn't make it", run at the end of tryouts.
--
-- The keep signal is being placed in a LANE -- not being linked to a
-- profile. Accounts get created weeks after cuts, so at the moment this
-- runs almost nobody is linked yet and a link-based rule would delete the
-- whole team. Bubble and unplaced both count as not kept, which is what
-- makes emptying the bubble the same action as making the cut.
create or replace function public.cut_tryout_players_not_in_plan(p_plan_id uuid)
returns integer
language plpgsql
security definer
as $$
declare
  v_season uuid;
  v_deleted integer;
begin
  select season_id into v_season from public.team_plans where id = p_plan_id;

  with kept as (
    select tryout_player_id from public.team_plan_slots
    where plan_id = p_plan_id and zone = 'lane' and tryout_player_id is not null
  )
  delete from public.tryout_players t
  where t.season_id is not distinct from v_season
    and t.id not in (select tryout_player_id from kept);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.cut_tryout_players_not_in_plan(uuid) to authenticated;

-- ── duplicate a plan ──────────────────────────────────────────
-- Lanes and slots copied; the new plan is independent from the moment it
-- exists. This is what "project next year" and "start the summer league
-- board from the depth chart" both use.
create or replace function public.duplicate_team_plan(p_plan_id uuid, p_name text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_new_plan uuid;
  v_lane record;
  v_lane_map jsonb := '{}'::jsonb;
  v_new_lane uuid;
begin
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

grant execute on function public.duplicate_team_plan(uuid, text) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────
-- Coach-visible, player-invisible. A depth chart with bubble players and
-- cut decisions on it is not something a player should ever load.
alter table public.team_positions enable row level security;
alter table public.team_plans enable row level security;
alter table public.team_plan_lanes enable row level security;
alter table public.team_plan_slots enable row level security;

do $$
declare t text;
begin
  foreach t in array array['team_positions', 'team_plans', 'team_plan_lanes', 'team_plan_slots'] loop
    execute format('drop policy if exists "coaches manage %I" on public.%I', t, t);
    execute format($f$
      create policy "coaches manage %I" on public.%I
        for all using (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
        ) with check (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
        )
    $f$, t, t);
  end loop;
end $$;
