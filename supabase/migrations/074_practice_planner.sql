-- 074_practice_planner.sql
-- Practice Planner feature: rosters/teams, the schedule builder
-- (blocks -> segments -> drills), a separate practice drill library,
-- flexible groupings with attendance-aware snapshotting, and a
-- reverse-chronological "practice weeks" accordion.
--
-- Design notes (see chat for full reasoning):
--   - practice_blocks drive all time math (start_time + running
--     duration sum). No time range is ever stored, only computed.
--   - block_segments split a block by roster ("Varsity does X, JV
--     does Y at the same time") or mark it "combined" (spans every
--     column in the practice, e.g. stations or a guards/bigs split).
--   - segment_drills let one segment hold multiple simultaneous
--     drills (stations), each with its own duration/goal/coach.
--   - saved_groupings (e.g. "Varsity Starters") are living,
--     coach-editable definitions. Dropping one into a practice
--     SNAPSHOTS the members into segment_drill_groups so a later
--     edit to the saved grouping never rewrites a past practice.
--   - practice_attendance_overrides is scoped to one practice only:
--     'call_up' adds an outside player in, 'excused' hides a
--     rostered player, neither touches the player's real roster.

-- ── Helper functions (SECURITY DEFINER to avoid RLS recursion,
--    same pattern used in 066/067 for plays) ────────────────────

create or replace function public.is_staff(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = uid and role in ('coach', 'admin')
  );
$$;

-- ── Rosters ──────────────────────────────────────────────────

create table if not exists public.rosters (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  color              text not null default '#1a3fa8',
  roster_type        text not null default 'permanent'
                     check (roster_type in ('permanent', 'seasonal')),
  status             text not null default 'active'
                     check (status in ('active', 'archived')),
  default_coach_name text,
  sort_order         int  not null default 0,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);

insert into public.rosters (name, color, roster_type, sort_order) values
  ('Varsity',  '#1a3fa8', 'permanent', 0),
  ('JV',       '#8a8f98', 'permanent', 1),
  ('Freshman', '#e8e8e8', 'permanent', 2)
on conflict (name) do nothing;

alter table public.rosters enable row level security;

drop policy if exists "rosters_read_all" on public.rosters;
create policy "rosters_read_all" on public.rosters
  for select using (true);

drop policy if exists "rosters_staff_write" on public.rosters;
create policy "rosters_staff_write" on public.rosters
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- Each player's one fixed team.
alter table public.profiles
  add column if not exists home_roster_id uuid references public.rosters(id) on delete set null;

-- ── Practice weeks (accordion groups, newest first) ─────────

create table if not exists public.practice_weeks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.practice_weeks enable row level security;

drop policy if exists "practice_weeks_read_all" on public.practice_weeks;
create policy "practice_weeks_read_all" on public.practice_weeks
  for select using (true);

drop policy if exists "practice_weeks_staff_write" on public.practice_weeks;
create policy "practice_weeks_staff_write" on public.practice_weeks
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- ── Practices ────────────────────────────────────────────────

create table if not exists public.practices (
  id            uuid primary key default gen_random_uuid(),
  week_id       uuid references public.practice_weeks(id) on delete set null,
  practice_date date not null,
  start_time    time not null,
  roster_ids    uuid[] not null default '{}',
  status        text not null default 'draft'
                check (status in ('draft', 'published')),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists practices_week_idx on public.practices(week_id);
create index if not exists practices_date_idx on public.practices(practice_date);

-- ── Attendance overrides (per-practice only) ────────────────

create table if not exists public.practice_attendance_overrides (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references public.practices(id) on delete cascade,
  player_id     uuid not null references public.profiles(id) on delete cascade,
  override_type text not null check (override_type in ('call_up', 'excused')),
  reason        text,
  created_at    timestamptz not null default now(),
  unique (practice_id, player_id)
);

create index if not exists attendance_overrides_practice_idx on public.practice_attendance_overrides(practice_id);

-- A player is an "effective attendee" of a practice if:
--   (their home roster is in the practice's roster_ids AND they are
--    not excused) OR they have a call_up override for this practice.
create or replace function public.is_effective_attendee(p_practice_id uuid, p_player_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1
      from public.practices pr
      join public.profiles pl on pl.id = p_player_id
      where pr.id = p_practice_id
        and pl.home_roster_id = any(pr.roster_ids)
        and not exists (
          select 1 from public.practice_attendance_overrides o
          where o.practice_id = p_practice_id
            and o.player_id = p_player_id
            and o.override_type = 'excused'
        )
    )
    or exists (
      select 1 from public.practice_attendance_overrides o
      where o.practice_id = p_practice_id
        and o.player_id = p_player_id
        and o.override_type = 'call_up'
    );
$$;

alter table public.practices enable row level security;

drop policy if exists "practices_staff_all" on public.practices;
create policy "practices_staff_all" on public.practices
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

drop policy if exists "practices_player_read_published" on public.practices;
create policy "practices_player_read_published" on public.practices
  for select using (
    status = 'published' and public.is_effective_attendee(id, auth.uid())
  );

alter table public.practice_attendance_overrides enable row level security;

drop policy if exists "attendance_overrides_staff_all" on public.practice_attendance_overrides;
create policy "attendance_overrides_staff_all" on public.practice_attendance_overrides
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- ── Blocks -> Segments -> Drills ─────────────────────────────

create table if not exists public.practice_blocks (
  id               uuid primary key default gen_random_uuid(),
  practice_id      uuid not null references public.practices(id) on delete cascade,
  order_index      int  not null default 0,
  duration_minutes int  not null default 10,
  created_at       timestamptz not null default now()
);

create index if not exists practice_blocks_practice_idx on public.practice_blocks(practice_id);

create table if not exists public.block_segments (
  id         uuid primary key default gen_random_uuid(),
  block_id   uuid not null references public.practice_blocks(id) on delete cascade,
  scope_type text not null default 'combined' check (scope_type in ('roster', 'combined')),
  roster_id  uuid references public.rosters(id) on delete cascade, -- null when scope_type = 'combined'
  created_at timestamptz not null default now(),
  check ((scope_type = 'roster' and roster_id is not null) or (scope_type = 'combined' and roster_id is null))
);

create index if not exists block_segments_block_idx on public.block_segments(block_id);

alter table public.practice_blocks enable row level security;
alter table public.block_segments enable row level security;

drop policy if exists "practice_blocks_staff_all" on public.practice_blocks;
create policy "practice_blocks_staff_all" on public.practice_blocks
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

drop policy if exists "practice_blocks_player_read" on public.practice_blocks;
create policy "practice_blocks_player_read" on public.practice_blocks
  for select using (
    exists (
      select 1 from public.practices pr
      where pr.id = practice_blocks.practice_id
        and pr.status = 'published'
        and public.is_effective_attendee(pr.id, auth.uid())
    )
  );

drop policy if exists "block_segments_staff_all" on public.block_segments;
create policy "block_segments_staff_all" on public.block_segments
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

drop policy if exists "block_segments_player_read" on public.block_segments;
create policy "block_segments_player_read" on public.block_segments
  for select using (
    exists (
      select 1 from public.practice_blocks b
      join public.practices pr on pr.id = b.practice_id
      where b.id = block_segments.block_id
        and pr.status = 'published'
        and public.is_effective_attendee(pr.id, auth.uid())
    )
  );

-- ── Practice drill library (separate from the offseason one) ─

create table if not exists public.practice_drill_categories (
  name       text primary key,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

insert into public.practice_drill_categories (name, sort_order) values
  ('Warmup',     0),
  ('Stations',   1),
  ('Transition', 2),
  ('Half Court', 3),
  ('Special Situations', 4)
on conflict (name) do nothing;

create table if not exists public.practice_drills_library (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null,
  description             text,
  video_url               text,
  category_name           text references public.practice_drill_categories(name)
                          on update cascade on delete set null,
  default_duration_minutes int,
  default_group_size      int,
  default_num_groups      int,
  linked_play_id          uuid references public.plays(id) on delete set null,
  is_starred              boolean not null default false,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table if not exists public.practice_drill_tags (
  name text primary key
);

create table if not exists public.practice_drill_tag_links (
  drill_id uuid not null references public.practice_drills_library(id) on delete cascade,
  tag_name text not null references public.practice_drill_tags(name)
           on update cascade on delete cascade,
  primary key (drill_id, tag_name)
);

alter table public.practice_drill_categories enable row level security;
alter table public.practice_drills_library enable row level security;
alter table public.practice_drill_tags enable row level security;
alter table public.practice_drill_tag_links enable row level security;

drop policy if exists "practice_drill_categories_read_all" on public.practice_drill_categories;
create policy "practice_drill_categories_read_all" on public.practice_drill_categories
  for select using (true);
drop policy if exists "practice_drill_categories_staff_write" on public.practice_drill_categories;
create policy "practice_drill_categories_staff_write" on public.practice_drill_categories
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy if exists "practice_drills_library_staff_all" on public.practice_drills_library;
create policy "practice_drills_library_staff_all" on public.practice_drills_library
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy if exists "practice_drill_tags_read_all" on public.practice_drill_tags;
create policy "practice_drill_tags_read_all" on public.practice_drill_tags
  for select using (true);
drop policy if exists "practice_drill_tags_staff_write" on public.practice_drill_tags;
create policy "practice_drill_tags_staff_write" on public.practice_drill_tags
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy if exists "practice_drill_tag_links_staff_all" on public.practice_drill_tag_links;
create policy "practice_drill_tag_links_staff_all" on public.practice_drill_tag_links
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- ── Segment drills (the actual scheduled items) ─────────────

create table if not exists public.segment_drills (
  id               uuid primary key default gen_random_uuid(),
  segment_id       uuid not null references public.block_segments(id) on delete cascade,
  drill_id         uuid references public.practice_drills_library(id) on delete set null,
  order_index      int  not null default 0,
  label            text, -- "Station 1", "Guards", etc.
  duration_minutes int  not null default 5,
  goal_text        text,
  coach_name       text,
  group_size       int,
  num_groups       int,
  created_at       timestamptz not null default now()
);

create index if not exists segment_drills_segment_idx on public.segment_drills(segment_id);

alter table public.segment_drills enable row level security;

drop policy if exists "segment_drills_staff_all" on public.segment_drills;
create policy "segment_drills_staff_all" on public.segment_drills
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy if exists "segment_drills_player_read" on public.segment_drills;
create policy "segment_drills_player_read" on public.segment_drills
  for select using (
    exists (
      select 1 from public.block_segments s
      join public.practice_blocks b on b.id = s.block_id
      join public.practices pr on pr.id = b.practice_id
      where s.id = segment_drills.segment_id
        and pr.status = 'published'
        and public.is_effective_attendee(pr.id, auth.uid())
    )
  );

-- ── Saved groupings (coach-only, e.g. "Varsity Starters") ────

create table if not exists public.saved_groupings (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  roster_id  uuid not null references public.rosters(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, roster_id)
);

create table if not exists public.saved_grouping_members (
  grouping_id uuid not null references public.saved_groupings(id) on delete cascade,
  player_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (grouping_id, player_id)
);

alter table public.saved_groupings enable row level security;
alter table public.saved_grouping_members enable row level security;

-- Coach-only in every direction — players never see grouping names.
drop policy if exists "saved_groupings_staff_only" on public.saved_groupings;
create policy "saved_groupings_staff_only" on public.saved_groupings
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy if exists "saved_grouping_members_staff_only" on public.saved_grouping_members;
create policy "saved_grouping_members_staff_only" on public.saved_grouping_members
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- ── Segment drill groups (snapshotted assignment for one practice) ─

create table if not exists public.segment_drill_groups (
  id                       uuid primary key default gen_random_uuid(),
  segment_drill_id         uuid not null references public.segment_drills(id) on delete cascade,
  group_label              text,
  source_saved_grouping_id uuid references public.saved_groupings(id) on delete set null,
  order_index              int not null default 0,
  created_at               timestamptz not null default now()
);

create table if not exists public.segment_drill_group_members (
  group_id  uuid not null references public.segment_drill_groups(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  primary key (group_id, player_id)
);

create index if not exists segment_drill_groups_sd_idx on public.segment_drill_groups(segment_drill_id);

alter table public.segment_drill_groups enable row level security;
alter table public.segment_drill_group_members enable row level security;

-- Coach-only — group membership (including who's a "starter") stays
-- invisible to players per the product decision in chat.
drop policy if exists "segment_drill_groups_staff_only" on public.segment_drill_groups;
create policy "segment_drill_groups_staff_only" on public.segment_drill_groups
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy if exists "segment_drill_group_members_staff_only" on public.segment_drill_group_members;
create policy "segment_drill_group_members_staff_only" on public.segment_drill_group_members
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
