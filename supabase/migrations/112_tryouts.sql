-- 112_tryouts.sql
--
-- Tryout practices, and the people at them who don't have accounts.
--
-- WHY A SEPARATE TABLE RATHER THAN FLAGGED PROFILES
--
-- The obvious shortcut is a profiles row per tryout kid with an
-- is_tryout flag. It isn't available: profiles.id references
-- auth.users(id), so a profile cannot exist without a real auth account,
-- and 40 tryout kids are not signing up for accounts to be cut on
-- Thursday.
--
-- That constraint is doing us a favour. Flagged profiles would leak into
-- leaderboards, rankings, roster counts, H2H opponent lists, badge
-- awards and push targets, and every one of those would need an
-- is_tryout filter forever. A separate table can't leak into any of them,
-- because nothing else joins to it.
--
-- THE COST: POLYMORPHIC GROUP MEMBERSHIP
--
-- segment_drill_group_members.player_id is a NOT NULL FK to profiles, so
-- a tryout name can't join a group as things stand. Same for
-- saved_grouping_members. Both become "exactly one of profile or tryout
-- player", enforced by a check constraint so a row can never be both or
-- neither.
--
-- DISPOSABLE BY DESIGN
--
-- No promotion path to a real profile. Once cuts are made the pool gets
-- deleted, and cascades take the group memberships and attendance with
-- it. That's why nothing outside this file references a tryout player.

-- ── the pool ──────────────────────────────────────────────────
-- One pool per season rather than per practice: day two of tryouts
-- shouldn't mean retyping forty names. Every tryout practice in the
-- season draws from the same pool.
create table if not exists public.tryout_players (
  id          uuid primary key default gen_random_uuid(),
  -- Matches practice_weeks.season_id: a real FK, not a free-text label.
  -- Nullable so a pool built before a season exists isn't blocked.
  season_id   uuid references public.seasons(id) on delete cascade,
  name        text not null,
  jersey      integer,
  -- Free-text evaluation. Cumulative across the tryout rather than
  -- per-practice: a coach wants one place to look when making cuts, not
  -- three days of separate notes to reconcile.
  notes       text,
  -- 'cut' hides them from group building without destroying the notes
  -- that justified the decision. Deleting would lose exactly the record
  -- you'd want if a parent asks why.
  status      text not null default 'active' check (status in ('active', 'cut')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists tryout_players_season_idx on public.tryout_players(season_id, status);

-- ── tryout practices ──────────────────────────────────────────
-- A regular practice never shows the pool, and a tryout practice never
-- shows the roster -- that separation is the whole point of the flag.
alter table public.practices
  add column if not exists is_tryout boolean not null default false;

-- ── attendance ────────────────────────────────────────────────
-- Deliberately NOT reusing practice_attendance_overrides. That table is
-- exception-based: every rostered player is assumed present and only
-- absences are recorded. Tryouts have no roster to assume from, so
-- presence has to be recorded positively -- a row here means they showed.
create table if not exists public.tryout_attendance (
  practice_id      uuid not null references public.practices(id) on delete cascade,
  tryout_player_id uuid not null references public.tryout_players(id) on delete cascade,
  present          boolean not null default true,
  created_at       timestamptz not null default now(),
  primary key (practice_id, tryout_player_id)
);

create index if not exists tryout_attendance_practice_idx on public.tryout_attendance(practice_id);

-- ── polymorphic group membership ──────────────────────────────
-- ORDER MATTERS HERE. The old primary key is (group_id, player_id), and
-- Postgres refuses to drop NOT NULL from a column that's part of a
-- primary key -- "column player_id is in a primary key". So the surrogate
-- key has to be fully in place and the old constraint gone BEFORE
-- player_id can become nullable.
alter table public.segment_drill_group_members
  add column if not exists id uuid default gen_random_uuid();

update public.segment_drill_group_members set id = gen_random_uuid() where id is null;

alter table public.segment_drill_group_members
  alter column id set not null;

alter table public.segment_drill_group_members
  drop constraint if exists segment_drill_group_members_pkey;

alter table public.segment_drill_group_members
  add constraint segment_drill_group_members_pkey primary key (id);

-- Only now is player_id free of the primary key.
alter table public.segment_drill_group_members
  alter column player_id drop not null;

alter table public.segment_drill_group_members
  add column if not exists tryout_player_id uuid references public.tryout_players(id) on delete cascade;

create unique index if not exists sdgm_profile_uniq
  on public.segment_drill_group_members(group_id, player_id) where player_id is not null;
create unique index if not exists sdgm_tryout_uniq
  on public.segment_drill_group_members(group_id, tryout_player_id) where tryout_player_id is not null;

alter table public.segment_drill_group_members
  drop constraint if exists sdgm_one_participant;
alter table public.segment_drill_group_members
  add constraint sdgm_one_participant
  check ((player_id is not null) <> (tryout_player_id is not null));

-- Same treatment for saved groupings, so a good set of tryout groups
-- from day one can be reused on day two.
-- Same ordering constraint as above: surrogate key first, old primary key
-- dropped, and only then can player_id become nullable.
alter table public.saved_grouping_members
  add column if not exists id uuid default gen_random_uuid();

update public.saved_grouping_members set id = gen_random_uuid() where id is null;

alter table public.saved_grouping_members
  alter column id set not null;

alter table public.saved_grouping_members
  drop constraint if exists saved_grouping_members_pkey;

alter table public.saved_grouping_members
  add constraint saved_grouping_members_pkey primary key (id);

alter table public.saved_grouping_members
  alter column player_id drop not null;

alter table public.saved_grouping_members
  add column if not exists tryout_player_id uuid references public.tryout_players(id) on delete cascade;

create unique index if not exists sgm_profile_uniq
  on public.saved_grouping_members(grouping_id, player_id, group_index) where player_id is not null;
create unique index if not exists sgm_tryout_uniq
  on public.saved_grouping_members(grouping_id, tryout_player_id, group_index) where tryout_player_id is not null;

alter table public.saved_grouping_members
  drop constraint if exists sgm_one_participant;
alter table public.saved_grouping_members
  add constraint sgm_one_participant
  check ((player_id is not null) <> (tryout_player_id is not null));

-- ── clearing the pool ─────────────────────────────────────────
-- One call once cuts are made. Cascades take group memberships and
-- attendance with them, which is the intended behaviour: tryout data is
-- disposable and shouldn't linger in last season's practice plans.
create or replace function public.clear_tryout_pool(p_season_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  delete from public.tryout_players where season_id is not distinct from p_season_id;
end;
$$;

grant execute on function public.clear_tryout_pool(uuid) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────
-- Coaches and admins only, on every tryout table. Players must never see
-- the pool: it contains names of kids who didn't make the team and notes
-- explaining why.
alter table public.tryout_players enable row level security;
alter table public.tryout_attendance enable row level security;

drop policy if exists "coaches manage tryout players" on public.tryout_players;
create policy "coaches manage tryout players" on public.tryout_players
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "coaches manage tryout attendance" on public.tryout_attendance;
create policy "coaches manage tryout attendance" on public.tryout_attendance
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );
