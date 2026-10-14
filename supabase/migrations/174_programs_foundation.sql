-- ============================================================
-- 174_programs_foundation.sql
--
-- MULTI-TENANCY STEP 1 — the foundation.
--
-- Creates organizations / programs / program_members / platform_admins /
-- program_features, the helper functions every converted policy will
-- use, and backfills Attleboro as the first organization with two
-- programs (Boys Basketball, Girls Basketball).
--
-- What changes for people TODAY:
--   * wpondolfino@attleboroschools.com becomes an admin (head coach).
--   * Everything pondo2345@gmail.com created (plays, playbooks, saved
--     actions, templates, workouts, practices, scout sheets, games…)
--     is moved to wpondolfino@attleboroschools.com. pondo2345 can still
--     SEE all of it as an admin, but plays become editable only by the
--     school account (plays are owner-edit today).
--
-- What does NOT change yet: every existing table still works exactly
-- as before. The app keeps using profiles.role. Nothing is scoped to a
-- program until the conversion migrations that follow this one.
--
-- Runs in one transaction. Stops before changing anything if any of
-- the three accounts below can't be found.
-- ============================================================

begin;

-- ── 0. The three accounts this file needs ─────────────────────

create temp table _acct on commit drop as
select
  (select id from auth.users where lower(email) = 'pondo2345@gmail.com')               as platform_admin,
  (select id from auth.users where lower(email) = 'wpondolfino@attleboroschools.com')  as boys_head,
  (select id from auth.users where lower(email) = 'bbracken@attleborops.net')          as girls_head;

do $$
declare a record;
begin
  select * into a from _acct;
  if a.platform_admin is null then raise exception 'Stopped: no account for pondo2345@gmail.com'; end if;
  if a.boys_head      is null then raise exception 'Stopped: no account for wpondolfino@attleboroschools.com'; end if;
  if a.girls_head     is null then raise exception 'Stopped: no account for bbracken@attleborops.net'; end if;
  if not exists (select 1 from public.profiles where id = a.boys_head)  then raise exception 'Stopped: wpondolfino@attleboroschools.com has no profile row'; end if;
  if not exists (select 1 from public.profiles where id = a.girls_head) then raise exception 'Stopped: bbracken@attleborops.net has no profile row'; end if;
end $$;


-- ── 1. Tables ─────────────────────────────────────────────────

-- Colors are stored as hex codes ("#1a3fa8"). Blank = use the default.
create or replace function public.is_hex_color(c text)
returns boolean language sql immutable as $$
  select c is null or c ~ '^#[0-9a-fA-F]{6}$'
$$;

create table if not exists public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  short_name      text,
  kind            text not null default 'school' check (kind in ('school', 'trainer')),
  primary_color   text check (public.is_hex_color(primary_color)),
  secondary_color text check (public.is_hex_color(secondary_color)),
  accent_color    text check (public.is_hex_color(accent_color)),
  logo_url        text,
  timezone        text not null default 'America/New_York',
  created_at      timestamptz not null default now()
);

-- Join codes: 6 characters, no look-alikes (no 0/O, 1/I/L).
create or replace function public.new_join_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.programs where join_code = code);
  end loop;
  return code;
end $$;

create table if not exists public.programs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name            text not null,
  sport           text not null default 'basketball',
  join_code       text unique,
  -- Optional overrides; blank falls back to the organization's.
  primary_color   text check (public.is_hex_color(primary_color)),
  secondary_color text check (public.is_hex_color(secondary_color)),
  accent_color    text check (public.is_hex_color(accent_color)),
  logo_url        text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);
alter table public.programs alter column join_code set default public.new_join_code();

create table if not exists public.program_members (
  program_id  uuid not null references public.programs(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('head_coach', 'coach', 'player')),
  status      text not null default 'active' check (status in ('pending', 'active', 'inactive')),
  is_test     boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (program_id, user_id)
);
create index if not exists program_members_user_idx on public.program_members(user_id);

-- ON DELETE RESTRICT: the platform admin's account can't be deleted
-- while it's listed here (54 tables cascade-delete with a profile).
create table if not exists public.platform_admins (
  user_id    uuid primary key references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- No row = enabled. Turning a feature off for a program = a row with
-- enabled = false. Gating itself comes in a later phase.
create table if not exists public.program_features (
  program_id  uuid not null references public.programs(id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null,
  primary key (program_id, feature_key)
);

alter table public.profiles
  add column if not exists active_program_id uuid references public.programs(id) on delete set null;


-- ── 2. Helper functions ───────────────────────────────────────

create or replace function public.is_platform_admin(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = uid);
$$;

-- The caller's ACTIVE role in a program (null if none).
create or replace function public.program_role(pid uuid, uid uuid)
returns text language sql security definer stable set search_path = public as $$
  select role from public.program_members
  where program_id = pid and user_id = uid and status = 'active';
$$;

create or replace function public.is_program_member(pid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_platform_admin(uid) or public.program_role(pid, uid) is not null;
$$;

create or replace function public.is_program_staff(pid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_platform_admin(uid)
      or coalesce(public.program_role(pid, uid) in ('head_coach', 'coach'), false);
$$;

create or replace function public.is_program_head_coach(pid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_platform_admin(uid)
      or coalesce(public.program_role(pid, uid) = 'head_coach', false);
$$;

-- The program the caller is currently working in — only if they're
-- actually allowed in it. Every converted policy will compare a row's
-- program_id against this.
create or replace function public.current_program_id()
returns uuid language sql security definer stable set search_path = public as $$
  select p.active_program_id
  from public.profiles p
  where p.id = auth.uid()
    and p.active_program_id is not null
    and public.is_program_member(p.active_program_id, auth.uid());
$$;

create or replace function public.has_feature(pid uuid, key text)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select enabled from public.program_features where program_id = pid and feature_key = key),
    true);
$$;

-- The program switcher calls this.
create or replace function public.set_active_program(pid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_program_member(pid, auth.uid()) then
    raise exception 'You are not a member of that program' using errcode = '42501';
  end if;
  update public.profiles set active_program_id = pid where id = auth.uid();
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'is_platform_admin(uuid)', 'program_role(uuid, uuid)', 'is_program_member(uuid, uuid)',
    'is_program_staff(uuid, uuid)', 'is_program_head_coach(uuid, uuid)',
    'current_program_id()', 'has_feature(uuid, text)', 'set_active_program(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- new_join_code is only used as a column default.
  revoke all on function public.new_join_code() from public, anon, authenticated;
end $$;


-- ── 3. Security on the new tables ─────────────────────────────

alter table public.organizations    enable row level security;
alter table public.programs         enable row level security;
alter table public.program_members  enable row level security;
alter table public.platform_admins  enable row level security;
alter table public.program_features enable row level security;

-- Organizations: visible to members of any of its programs; only the
-- platform admin creates or edits them.
drop policy if exists "org_read" on public.organizations;
create policy "org_read" on public.organizations for select to authenticated
  using (public.is_platform_admin(auth.uid())
         or exists (select 1 from public.programs pr
                    where pr.organization_id = organizations.id
                      and public.is_program_member(pr.id, auth.uid())));
drop policy if exists "org_platform_write" on public.organizations;
create policy "org_platform_write" on public.organizations for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

-- Programs: members see their own; head coaches edit name/branding only
-- (column grants below); the platform admin does everything else.
drop policy if exists "programs_read" on public.programs;
create policy "programs_read" on public.programs for select to authenticated
  using (public.is_program_member(id, auth.uid()));
drop policy if exists "programs_head_coach_update" on public.programs;
create policy "programs_head_coach_update" on public.programs for update to authenticated
  using (public.is_program_head_coach(id, auth.uid()))
  with check (public.is_program_head_coach(id, auth.uid()));
drop policy if exists "programs_platform_write" on public.programs;
create policy "programs_platform_write" on public.programs for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));
revoke update on public.programs from authenticated;
grant update (name, primary_color, secondary_color, accent_color, logo_url) on public.programs to authenticated;

-- Members: you see your own rows; staff see their program's roster.
-- Head coaches manage coaches and players, but ONLY the platform admin
-- can add, change or remove a head coach.
drop policy if exists "members_read" on public.program_members;
create policy "members_read" on public.program_members for select to authenticated
  using (user_id = auth.uid() or public.is_program_staff(program_id, auth.uid()));
drop policy if exists "members_head_coach_manage" on public.program_members;
create policy "members_head_coach_manage" on public.program_members for all to authenticated
  using (public.is_program_head_coach(program_id, auth.uid()) and role <> 'head_coach')
  with check (public.is_program_head_coach(program_id, auth.uid()) and role <> 'head_coach');
drop policy if exists "members_platform_manage" on public.program_members;
create policy "members_platform_manage" on public.program_members for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

-- Platform admins: you can only see whether YOU are one. No API writes.
drop policy if exists "platform_admins_self" on public.platform_admins;
create policy "platform_admins_self" on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- Features: members read; only the platform admin changes them.
drop policy if exists "features_read" on public.program_features;
create policy "features_read" on public.program_features for select to authenticated
  using (public.is_program_member(program_id, auth.uid()));
drop policy if exists "features_platform_write" on public.program_features;
create policy "features_platform_write" on public.program_features for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

-- Logged-out visitors get nothing (172 set this as the default, but be explicit).
revoke all on public.organizations, public.programs, public.program_members,
              public.platform_admins, public.program_features from anon;


-- ── 4. Backfill: Attleboro, two programs, memberships ─────────

insert into public.organizations (name, short_name, kind, primary_color, secondary_color, accent_color, timezone)
select 'Attleboro High School', 'AHS', 'school', '#1a3fa8', '#b0b8c8', '#f0c040', 'America/New_York'
where not exists (select 1 from public.organizations where name = 'Attleboro High School');

insert into public.programs (organization_id, name)
select o.id, v.name
from public.organizations o
cross join (values ('Boys Basketball'), ('Girls Basketball')) as v(name)
where o.name = 'Attleboro High School'
on conflict (organization_id, name) do nothing;

create temp table _prog on commit drop as
select
  (select pr.id from public.programs pr join public.organizations o on o.id = pr.organization_id
    where o.name = 'Attleboro High School' and pr.name = 'Boys Basketball')  as boys,
  (select pr.id from public.programs pr join public.organizations o on o.id = pr.organization_id
    where o.name = 'Attleboro High School' and pr.name = 'Girls Basketball') as girls;

-- Platform admin.
insert into public.platform_admins (user_id)
select platform_admin from _acct
on conflict do nothing;

-- Every current account joins Boys Basketball with its current role —
-- except the platform admin (sits above programs) and the girls' head
-- coach (gets her own program below).
insert into public.program_members (program_id, user_id, role, status)
select g.boys, p.id,
  case p.role
    when 'admin'          then 'head_coach'
    when 'coach'          then 'coach'
    when 'pending_coach'  then 'coach'
    else 'player'               -- player, inactive, pending_player
  end,
  case p.role
    when 'inactive'       then 'inactive'
    when 'pending_player' then 'pending'
    when 'pending_coach'  then 'pending'
    else 'active'
  end
from public.profiles p, _prog g, _acct a
where p.id not in (a.platform_admin, a.girls_head)
on conflict (program_id, user_id) do nothing;

-- Your school account: head coach of Boys Basketball.
insert into public.program_members (program_id, user_id, role, status)
select g.boys, a.boys_head, 'head_coach', 'active' from _prog g, _acct a
on conflict (program_id, user_id) do update set role = 'head_coach', status = 'active';

-- Bracken: head coach of Girls Basketball.
insert into public.program_members (program_id, user_id, role, status)
select g.girls, a.girls_head, 'head_coach', 'active' from _prog g, _acct a
on conflict (program_id, user_id) do update set role = 'head_coach', status = 'active';

-- Everyone starts in Boys; Bracken starts in Girls.
update public.profiles set active_program_id = (select boys from _prog)
where active_program_id is null;
update public.profiles set active_program_id = (select girls from _prog)
where id = (select girls_head from _acct);

-- Today's app still reads profiles.role, so the school account needs
-- 'admin' there to get head-coach tools now.
update public.profiles set role = 'admin'
where id = (select boys_head from _acct);


-- ── 5. Move pondo2345's content to the school account ─────────
-- Authorship columns only. Personal rows (notifications, tutorials
-- seen, announcement hides, things shared TO pondo2345) stay put.

do $$
declare
  src uuid := (select platform_admin from _acct);
  dst uuid := (select boys_head from _acct);
  t record;
begin
  for t in
    select * from (values
      ('announcements', 'coach_id'),     ('competitions', 'created_by'),
      ('formations', 'created_by'),      ('game_call_ups', 'created_by'),
      ('gameday_sheets', 'created_by'),  ('games', 'created_by'),
      ('help_pages', 'updated_by'),      ('lifting_exercise_bank', 'created_by'),
      ('lifting_programs', 'created_by'),('lineup_events', 'created_by'),
      ('live_sessions', 'host_id'),      ('opponents', 'created_by'),
      ('play_calls', 'created_by'),      ('play_shares', 'shared_by'),
      ('playbooks', 'created_by'),       ('plays', 'created_by'),
      ('possessions', 'created_by'),     ('practice_cover_items', 'added_by'),
      ('practice_drills_library', 'created_by'), ('practice_weeks', 'created_by'),
      ('practice_wins', 'logged_by'),    ('practices', 'created_by'),
      ('quizzes', 'created_by'),         ('report_layout', 'updated_by'),
      ('rosters', 'created_by'),         ('rotation_plans', 'created_by'),
      ('saved_actions', 'created_by'),   ('saved_groupings', 'created_by'),
      ('saved_reports', 'created_by'),   ('schedule_events', 'created_by'),
      ('scout_sheets', 'created_by'),    ('seasons', 'created_by'),
      ('shifts', 'created_by'),          ('stat_goals', 'updated_by'),
      ('team_plans', 'created_by'),      ('tryout_players', 'created_by'),
      ('workout_groups', 'created_by'),  ('workouts', 'coach_id')
    ) as v(tbl, col)
  loop
    execute format('update public.%I set %I = $1 where %I = $2', t.tbl, t.col, t.col)
      using dst, src;
  end loop;

  -- A play pondo2345 had shared with the school account is now a share
  -- from the school account to itself — remove those.
  delete from public.play_shares where shared_by = shared_with;
end $$;

commit;


-- ── 6. Summary — this table appears in the results when it's done ──

select 'organizations'           as item, count(*)::text as value from public.organizations
union all select 'programs',                 string_agg(name || ' (code ' || join_code || ')', ', ' order by name) from public.programs
union all select 'platform admin',           (select u.email from public.platform_admins pa join auth.users u on u.id = pa.user_id limit 1)
union all select 'Boys head coaches',        (select string_agg(u.email, ', ') from public.program_members m join public.programs pr on pr.id = m.program_id join auth.users u on u.id = m.user_id where pr.name = 'Boys Basketball' and m.role = 'head_coach')
union all select 'Girls head coaches',       (select string_agg(u.email, ', ') from public.program_members m join public.programs pr on pr.id = m.program_id join auth.users u on u.id = m.user_id where pr.name = 'Girls Basketball' and m.role = 'head_coach')
union all select 'Boys members by role',     (select string_agg(role || '/' || status || ': ' || n, ', ') from (select role, status, count(*) n from public.program_members m join public.programs pr on pr.id = m.program_id where pr.name = 'Boys Basketball' group by 1, 2 order by 1, 2) x)
union all select 'accounts with no program', (select count(*)::text from public.profiles p where not exists (select 1 from public.program_members m where m.user_id = p.id) and not exists (select 1 from public.platform_admins pa where pa.user_id = p.id))
union all select 'plays still owned by pondo2345', (select count(*)::text from public.plays where created_by = (select id from auth.users where lower(email) = 'pondo2345@gmail.com'))
union all select 'plays owned by school account',  (select count(*)::text from public.plays where created_by = (select id from auth.users where lower(email) = 'wpondolfino@attleboroschools.com'));
