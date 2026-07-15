-- 066_plays_and_playbooks.sql
-- Play-drawing feature: players and staff can draw up plays/inbounds/press
-- breaks, save them, and share them explicitly. Coaches can bundle plays
-- into Playbooks and publish them to specific players, mirroring the
-- existing workout_groups draft/active/archived pattern (052).
--
-- Ownership model:
--   - A play belongs to whoever created it (created_by). It is never
--     visible to anyone else until explicitly shared via play_shares.
--   - Sharing is one row per (play, recipient) so it can be revoked
--     independently without touching the play itself.
--   - Playbooks are staff-owned collections of plays, published to
--     specific players via playbook_shares — same shape as
--     workout_groups + workouts.group_id, just for plays.
--
-- court_template values: 'half', 'full', 'baseline_oob', 'sideline_oob'.
-- `data` holds the play itself (players/defenders/ball/frames/actions) as
-- produced by the editor — kept as jsonb so the drawing format can evolve
-- (e.g. adding multi-frame sequences) without a schema migration.

-- ── Plays ────────────────────────────────────────────────────
create table if not exists public.plays (
  id             uuid primary key default gen_random_uuid(),
  created_by     uuid not null references public.profiles(id) on delete cascade,
  title          text not null,
  tags           text[] not null default '{}',
  court_template text not null default 'half'
                 check (court_template in ('half', 'full', 'baseline_oob', 'sideline_oob')),
  data           jsonb not null default '{}'::jsonb,
  forked_from    uuid references public.plays(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists plays_created_by_idx on public.plays(created_by);

alter table public.plays enable row level security;

drop policy if exists "plays_owner_all" on public.plays;
create policy "plays_owner_all" on public.plays
  for all using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Note: the "shared with me" read policy on plays is added further down,
-- after play_shares exists (a policy can't reference a table that isn't
-- created yet).

-- ── Play shares (explicit, revocable, per-recipient) ────────
create table if not exists public.play_shares (
  id          uuid primary key default gen_random_uuid(),
  play_id     uuid not null references public.plays(id) on delete cascade,
  shared_by   uuid not null references public.profiles(id) on delete cascade,
  shared_with uuid not null references public.profiles(id) on delete cascade,
  viewed_at   timestamptz,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (play_id, shared_with)
);

create index if not exists play_shares_shared_with_idx on public.play_shares(shared_with);
create index if not exists play_shares_play_id_idx on public.play_shares(play_id);

alter table public.play_shares enable row level security;

-- The play's owner manages who it's shared with.
drop policy if exists "play_shares_owner_manage" on public.play_shares;
create policy "play_shares_owner_manage" on public.play_shares
  for all using (
    exists (select 1 from public.plays where plays.id = play_shares.play_id and plays.created_by = auth.uid())
  )
  with check (
    exists (select 1 from public.plays where plays.id = play_shares.play_id and plays.created_by = auth.uid())
  );

-- A recipient can see (and update viewed_at on) their own share rows.
drop policy if exists "play_shares_recipient_read" on public.play_shares;
create policy "play_shares_recipient_read" on public.play_shares
  for select using (auth.uid() = shared_with);

drop policy if exists "play_shares_recipient_mark_viewed" on public.play_shares;
create policy "play_shares_recipient_mark_viewed" on public.play_shares
  for update using (auth.uid() = shared_with)
  with check (auth.uid() = shared_with);

-- Now that play_shares exists, a recipient can read a play shared with them.
drop policy if exists "plays_shared_read" on public.plays;
create policy "plays_shared_read" on public.plays
  for select using (
    exists (
      select 1 from public.play_shares
      where play_shares.play_id = plays.id
        and play_shares.shared_with = auth.uid()
        and play_shares.revoked_at is null
    )
  );

-- ── Saved actions (reusable stamps like "Flare screen") ─────
create table if not exists public.saved_actions (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  category   text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.saved_actions enable row level security;

drop policy if exists "saved_actions_owner_all" on public.saved_actions;
create policy "saved_actions_owner_all" on public.saved_actions
  for all using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- ── Playbooks (staff-owned collections, mirrors workout_groups) ─
create table if not exists public.playbooks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  status      text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz default now()
);

alter table public.playbooks enable row level security;

drop policy if exists "playbooks_staff_manage" on public.playbooks;
create policy "playbooks_staff_manage" on public.playbooks
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin'))
  );

-- Note: the "assigned to me" read policy on playbooks is added further
-- down, after playbook_shares exists.

-- ── Playbook contents (ordered plays within a playbook) ─────
create table if not exists public.playbook_plays (
  playbook_id uuid not null references public.playbooks(id) on delete cascade,
  play_id     uuid not null references public.plays(id) on delete cascade,
  sort_order  integer not null default 0,
  primary key (playbook_id, play_id)
);

alter table public.playbook_plays enable row level security;

drop policy if exists "playbook_plays_staff_manage" on public.playbook_plays;
create policy "playbook_plays_staff_manage" on public.playbook_plays
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin'))
  );

-- Note: the player read policy on playbook_plays is added further down,
-- after playbook_shares exists.

-- ── Playbook shares (who a published playbook is assigned to) ─
create table if not exists public.playbook_shares (
  id          uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.playbooks(id) on delete cascade,
  shared_with uuid not null references public.profiles(id) on delete cascade,
  viewed_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (playbook_id, shared_with)
);

create index if not exists playbook_shares_shared_with_idx on public.playbook_shares(shared_with);

alter table public.playbook_shares enable row level security;

drop policy if exists "playbook_shares_staff_manage" on public.playbook_shares;
create policy "playbook_shares_staff_manage" on public.playbook_shares
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin'))
  );

drop policy if exists "playbook_shares_recipient_read" on public.playbook_shares;
create policy "playbook_shares_recipient_read" on public.playbook_shares
  for select using (auth.uid() = shared_with);

drop policy if exists "playbook_shares_recipient_mark_viewed" on public.playbook_shares;
create policy "playbook_shares_recipient_mark_viewed" on public.playbook_shares
  for update using (auth.uid() = shared_with)
  with check (auth.uid() = shared_with);

-- Now that playbook_shares exists: a player can read a playbook (and its
-- plays) once it's active and assigned to them.
drop policy if exists "playbooks_player_read_assigned" on public.playbooks;
create policy "playbooks_player_read_assigned" on public.playbooks
  for select using (
    status = 'active'
    and exists (
      select 1 from public.playbook_shares
      where playbook_shares.playbook_id = playbooks.id
        and playbook_shares.shared_with = auth.uid()
    )
  );

drop policy if exists "playbook_plays_player_read" on public.playbook_plays;
create policy "playbook_plays_player_read" on public.playbook_plays
  for select using (
    exists (
      select 1 from public.playbook_shares ps
      join public.playbooks pb on pb.id = ps.playbook_id
      where ps.playbook_id = playbook_plays.playbook_id
        and ps.shared_with = auth.uid()
        and pb.status = 'active'
    )
  );

-- ── updated_at trigger for plays (matches editing pattern) ───
create or replace function public.set_plays_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists plays_set_updated_at on public.plays;
create trigger plays_set_updated_at
  before update on public.plays
  for each row execute function public.set_plays_updated_at();
