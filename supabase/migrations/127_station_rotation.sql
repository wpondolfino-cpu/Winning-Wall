-- 127_station_rotation.sql
--
-- Stations that rotate.
--
-- Migration 126 modelled stations as fixed: these eight people are at
-- station 2, full stop. That's right for bigs at one basket and guards at
-- another, and wrong for the commoner case — four groups moving between
-- four stations every few minutes.
--
-- In a rotation, "who is at station 2" isn't a fact, it's a fact at a
-- point in time. And the split is a property of the STATION rather than
-- the people: station 2 runs 4v4, so whoever arrives gets halved. You
-- aren't assigning people to a 4v4, you're saying this station is one.
--
-- So rotation needs different data, and less of it:
--   · groups belong to the block, made once
--   · each drill carries a RULE, not a member list
--   · the order is the drill order, generated rather than configured
--
-- station_member_ids from 126 stays and still drives the fixed mode. The
-- block's mode decides which is in play, so neither has to know about
-- the other.

-- ── which kind of stations this block is running ─────────────
alter table public.practice_blocks
  add column if not exists station_mode text not null default 'fixed'
  check (station_mode in ('fixed', 'rotating'));

comment on column public.practice_blocks.station_mode is
  'fixed = people are assigned to a station and stay there (station_member_ids on segment_drills). rotating = groups belong to the block and move between stations, each of which splits whoever arrives by its own rule.';

-- ── the groups that rotate ───────────────────────────────────
-- Order matters twice over: it decides which station a group starts at,
-- and — because a split has to be printable — which members end up on
-- which side when a station halves them.
create table if not exists public.block_rotation_groups (
  id          uuid primary key default gen_random_uuid(),
  block_id    uuid not null references public.practice_blocks(id) on delete cascade,
  group_index int  not null,
  member_ids  uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  unique (block_id, group_index)
);

create index if not exists block_rotation_groups_block_idx
  on public.block_rotation_groups(block_id);

alter table public.block_rotation_groups enable row level security;

drop policy if exists "block_rotation_groups_staff_all" on public.block_rotation_groups;
create policy "block_rotation_groups_staff_all" on public.block_rotation_groups
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "block_rotation_groups_player_read" on public.block_rotation_groups;
create policy "block_rotation_groups_player_read" on public.block_rotation_groups
  for select using (
    exists (
      select 1
      from public.practice_blocks b
      join public.practices pr on pr.id = b.practice_id
      where b.id = block_rotation_groups.block_id
        and pr.status = 'published'
    )
  );

-- ── how each station splits whoever's there ──────────────────
-- Two genuinely different rules, and one to leave a group alone:
--   none   — keep the group together
--   teams  — divide whoever arrives into N sides (6 into 2 = 3v3)
--   size   — make groups of N (6 with size 2 = three pairs)
--
-- Deliberately not one rule with a clever number. "Into 2 teams" and
-- "groups of 2" mean opposite things on a group of six, and picking one
-- to model both goes wrong in the other direction.
alter table public.segment_drills
  add column if not exists split_rule text not null default 'none'
  check (split_rule in ('none', 'teams', 'size'));

alter table public.segment_drills
  add column if not exists split_n int;

comment on column public.segment_drills.split_rule is
  'How this station divides whoever rotates in. none = keep together, teams = split into split_n sides, size = make groups of split_n. Only read when the block is rotating.';
