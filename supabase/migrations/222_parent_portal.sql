-- 222_parent_portal.sql
-- Parent portal, phase 1: joining, children, schedule, announcements and
-- absence reports.
--
-- HOW PARENTS ARE KEPT IN THEIR LANE
--   A parent account has role 'parent' and is NOT a member of any program.
--   That means every existing table stays closed to them, by the same
--   program fence that already keeps a pending signup out of everything.
--   Nothing that exists today gets a new rule.
--   Everything a parent sees comes through the functions below, which only
--   ever return their own approved child's team: the schedule (times and
--   places, never practice plans), announcements meant for parents, and
--   their own absence reports.
--
--   family_links         parent ↔ player, pending until a coach approves
--   family_invites       per-player invite links (?family=…), made by the
--                        player or a coach; the edge function family-invite
--                        uses them to set up parent accounts
--   parent_absences      "Liam will miss Tuesday" — practices are also
--                        marked excused on Practice Day
--   announcement_parent_reads  who has seen what ("seen by 12 of 20")
--   schedule_changes     a log of moved / cancelled practices, games and
--                        events, so parents see what changed
--   announcements        + audience (players / parents / both) and teams
--
-- Safe to run twice.

-- ── 1. The parent role ────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in
  ('player', 'coach', 'admin', 'inactive', 'pending_player', 'pending_coach', 'test_player', 'parent'));

-- ── 2. Families ───────────────────────────────────────────────
create table if not exists public.family_links (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  parent_id   uuid not null references public.profiles(id) on delete cascade,
  player_id   uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'active')),
  relation    text,
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  unique (parent_id, player_id)
);
create index if not exists family_links_player_idx on public.family_links (player_id);
create index if not exists family_links_program_idx on public.family_links (program_id, status);

create table if not exists public.family_invites (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  program_id  uuid not null references public.programs(id) on delete cascade,
  player_id   uuid not null references public.profiles(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  revoked_at  timestamptz
);
create index if not exists family_invites_player_idx on public.family_invites (player_id);

create table if not exists public.parent_absences (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  player_id   uuid not null references public.profiles(id) on delete cascade,
  parent_id   uuid references public.profiles(id) on delete set null,
  item_kind   text not null check (item_kind in ('practice', 'game', 'event')),
  item_id     uuid not null,
  item_date   date not null,
  item_label  text,
  reason      text not null,
  note        text,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz,
  unique (player_id, item_kind, item_id)
);
create index if not exists parent_absences_program_idx on public.parent_absences (program_id, created_at desc);

create table if not exists public.announcement_parent_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  parent_id       uuid not null references public.profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, parent_id)
);

create table if not exists public.schedule_changes (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid,
  item_kind   text not null,
  item_id     uuid not null,
  roster_ids  uuid[] not null default '{}',
  change      text not null check (change in ('moved', 'cancelled', 'place')),
  label       text,
  old_date    date,
  old_time    time,
  new_date    date,
  new_time    time,
  new_place   text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index if not exists schedule_changes_item_idx on public.schedule_changes (item_id, changed_at desc);
create index if not exists schedule_changes_program_idx on public.schedule_changes (program_id, changed_at desc);

-- Announcements: who it's for. Existing ones stay players-only.
alter table public.announcements add column if not exists audience text not null default 'players';
alter table public.announcements drop constraint if exists announcements_audience_check;
alter table public.announcements add constraint announcements_audience_check check (audience in ('players', 'parents', 'both'));
alter table public.announcements add column if not exists roster_ids uuid[] not null default '{}';

-- ── 3. Access ─────────────────────────────────────────────────
-- These tables check the program by hand (is_program_staff on the row's
-- program) instead of the usual program fence, because parents aren't in
-- any program and still need to read their own rows.
grant select, insert, update, delete on public.family_links, public.family_invites, public.parent_absences,
  public.announcement_parent_reads, public.schedule_changes to authenticated;

alter table public.family_links enable row level security;
drop policy if exists "family_links_staff" on public.family_links;
create policy "family_links_staff" on public.family_links
  for all using (public.is_program_staff(program_id, auth.uid())) with check (public.is_program_staff(program_id, auth.uid()));
drop policy if exists "family_links_own" on public.family_links;
create policy "family_links_own" on public.family_links
  for select using (parent_id = auth.uid());

alter table public.family_invites enable row level security;
drop policy if exists "family_invites_staff" on public.family_invites;
create policy "family_invites_staff" on public.family_invites
  for all using (public.is_program_staff(program_id, auth.uid())) with check (public.is_program_staff(program_id, auth.uid()));
drop policy if exists "family_invites_own_player" on public.family_invites;
create policy "family_invites_own_player" on public.family_invites
  for select using (player_id = auth.uid());

alter table public.parent_absences enable row level security;
drop policy if exists "parent_absences_staff" on public.parent_absences;
create policy "parent_absences_staff" on public.parent_absences
  for all using (public.is_program_staff(program_id, auth.uid())) with check (public.is_program_staff(program_id, auth.uid()));
drop policy if exists "parent_absences_own" on public.parent_absences;
create policy "parent_absences_own" on public.parent_absences
  for select using (parent_id = auth.uid());

alter table public.announcement_parent_reads enable row level security;
drop policy if exists "announcement_reads_own" on public.announcement_parent_reads;
create policy "announcement_reads_own" on public.announcement_parent_reads
  for select using (parent_id = auth.uid());

alter table public.schedule_changes enable row level security;
drop policy if exists "schedule_changes_staff" on public.schedule_changes;
create policy "schedule_changes_staff" on public.schedule_changes
  for select using (public.is_program_staff(program_id, auth.uid()));

-- Parents-only announcements stay out of the players' list, and an
-- announcement for one team only reaches that team's players.
drop policy if exists "announcements_parents_only_hidden" on public.announcements;
create policy "announcements_parents_only_hidden" on public.announcements
  as restrictive for select
  using (public.is_staff(auth.uid())
         or (audience <> 'parents'
             and (coalesce(cardinality(roster_ids), 0) = 0
                  or (select p.home_roster_id from public.profiles p where p.id = auth.uid()) = any(roster_ids))));

-- ── 4. Logging schedule changes ───────────────────────────────
create or replace function public._log_schedule_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text := tg_argv[0];
  o jsonb := to_jsonb(old);
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  date_col text := case k when 'practice' then 'practice_date' when 'game' then 'game_date' else 'event_date' end;
  time_col text := case k when 'game' then 'tip_time' else 'start_time' end;
  rosters uuid[];
  lbl text;
begin
  if k = 'practice' and coalesce((o->>'is_template')::boolean, false) then return coalesce(new, old); end if;
  rosters := case k when 'game' then case when o->>'roster_id' is null then '{}'::uuid[] else array[(o->>'roster_id')::uuid] end
                    else coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(o->'roster_ids') x), '{}') end;
  lbl := case k when 'practice' then case when coalesce((o->>'is_tryout')::boolean, false) then 'Tryout' else 'Practice' end
                when 'game' then case o->>'home_away' when 'away' then '@ ' when 'home' then 'vs ' else '' end || coalesce(o->>'opponent', 'Game')
                else coalesce(o->>'title', 'Event') end;
  -- Only future items matter to families.
  if (o->>date_col)::date < current_date and (n is null or (n->>date_col)::date < current_date) then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    insert into public.schedule_changes (program_id, item_kind, item_id, roster_ids, change, label, old_date, old_time, changed_by)
    values ((o->>'program_id')::uuid, k, (o->>'id')::uuid, rosters, 'cancelled', lbl, (o->>date_col)::date, (o->>time_col)::time, auth.uid());
  elsif (n->>date_col) is distinct from (o->>date_col) or (n->>time_col) is distinct from (o->>time_col) then
    insert into public.schedule_changes (program_id, item_kind, item_id, roster_ids, change, label, old_date, old_time, new_date, new_time, changed_by)
    values ((n->>'program_id')::uuid, k, (n->>'id')::uuid, rosters, 'moved', lbl, (o->>date_col)::date, (o->>time_col)::time,
            (n->>date_col)::date, (n->>time_col)::time, auth.uid());
  elsif k <> 'practice' and (n->>'location') is distinct from (o->>'location') then
    insert into public.schedule_changes (program_id, item_kind, item_id, roster_ids, change, label, new_date, new_time, new_place, changed_by)
    values ((n->>'program_id')::uuid, k, (n->>'id')::uuid, rosters, 'place', lbl, (n->>date_col)::date, (n->>time_col)::time,
            n->>'location', auth.uid());
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists log_schedule_change on public.practices;
create trigger log_schedule_change after update or delete on public.practices
  for each row execute function public._log_schedule_change('practice');
drop trigger if exists log_schedule_change on public.games;
create trigger log_schedule_change after update or delete on public.games
  for each row execute function public._log_schedule_change('game');
drop trigger if exists log_schedule_change on public.schedule_events;
create trigger log_schedule_change after update or delete on public.schedule_events
  for each row execute function public._log_schedule_change('event');

-- ── 5. Helpers ────────────────────────────────────────────────
-- Is the caller an approved parent of this player?
create or replace function public._is_parent_of(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.family_links f
                 where f.parent_id = auth.uid() and f.player_id = p_player and f.status = 'active');
$$;

-- The child's program and team (their home roster).
create or replace function public._child_team(p_player uuid)
returns table (program_id uuid, roster_id uuid) language sql stable security definer set search_path = public as $$
  select coalesce(
           (select f.program_id from public.family_links f where f.player_id = p_player and f.parent_id = auth.uid() limit 1),
           (select m.program_id from public.program_members m where m.user_id = p_player and m.status = 'active' limit 1)),
         (select p.home_roster_id from public.profiles p where p.id = p_player);
$$;

-- ── 6. What parents read ──────────────────────────────────────

-- The parent's children (approved and waiting).
create or replace function public.parent_children()
returns table (player_id uuid, name text, status text, program_id uuid, program_name text, team_name text,
               primary_color text, logo_url text)
language sql stable security definer set search_path = public as $$
  select f.player_id, p.name, f.status, f.program_id, pr.name, r.name, pr.primary_color, pr.logo_url
  from public.family_links f
  join public.profiles p on p.id = f.player_id
  join public.programs pr on pr.id = f.program_id
  left join public.rosters r on r.id = p.home_roster_id
  where f.parent_id = auth.uid()
  order by f.status, p.name;
$$;

-- The child's schedule from today: times and places only.
-- Tryout practices are left out, like they are for players.
create or replace function public.parent_schedule(p_player uuid, p_days int default 42)
returns table (kind text, id uuid, item_date date, start_time time, end_time time, title text, location text,
               bus_time time, home_away text, note text, absence_reason text,
               changed text, old_date date, old_time time)
language plpgsql stable security definer set search_path = public as $$
declare
  t record;
  v_to date := current_date + least(greatest(coalesce(p_days, 42), 1), 180);
begin
  if not public._is_parent_of(p_player) then return; end if;
  select * into t from public._child_team(p_player);
  return query
  with items as (
    select 'practice'::text as kind, pr.id, pr.practice_date as d, pr.start_time as st, pr.expected_end_time as et,
           'Practice'::text as title, null::text as loc, null::time as bus, null::text as ha, pr.schedule_note as note
    from public.practices pr
    where pr.program_id = t.program_id and not pr.is_template and not coalesce(pr.is_tryout, false)
      and pr.practice_date between current_date and v_to
      and (t.roster_id = any(pr.roster_ids)
           or exists (select 1 from public.practice_attendance_overrides o
                      where o.practice_id = pr.id and o.player_id = p_player and o.override_type = 'call_up'))
    union all
    select 'game', g.id, g.game_date, g.tip_time, null::time,
           case g.home_away when 'away' then '@ ' when 'home' then 'vs ' else '' end || g.opponent,
           g.location, g.bus_time, g.home_away, g.schedule_note
    from public.games g
    where g.program_id = t.program_id and g.game_date between current_date and v_to
      and (g.roster_id = t.roster_id
           or exists (select 1 from public.game_call_ups c where c.game_id = g.id and c.player_id = p_player))
    union all
    select 'event', e.id, e.event_date, e.start_time, null::time, e.title, e.location, null::time, null::text, e.schedule_note
    from public.schedule_events e
    where e.program_id = t.program_id and e.event_date between current_date and v_to
      and (coalesce(cardinality(e.roster_ids), 0) = 0 or t.roster_id = any(e.roster_ids))
  )
  select i.kind, i.id, i.d, i.st, i.et, i.title, i.loc, i.bus, i.ha, i.note,
         (select a.reason from public.parent_absences a where a.player_id = p_player and a.item_id = i.id limit 1),
         c.change, c.old_date, c.old_time
  from items i
  left join lateral (
    select sc.change, sc.old_date, sc.old_time from public.schedule_changes sc
    where sc.item_id = i.id and sc.changed_at > now() - interval '7 days'
    order by sc.changed_at desc limit 1
  ) c on true
  order by i.d, i.st nulls last;
end $$;

-- Cancelled in the last two weeks, still upcoming.
create or replace function public.parent_cancellations(p_player uuid)
returns table (kind text, item_id uuid, label text, old_date date, old_time time, changed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare t record;
begin
  if not public._is_parent_of(p_player) then return; end if;
  select * into t from public._child_team(p_player);
  return query
  select sc.item_kind, sc.item_id, sc.label, sc.old_date, sc.old_time, sc.changed_at
  from public.schedule_changes sc
  where sc.program_id = t.program_id and sc.change = 'cancelled'
    and sc.old_date >= current_date and sc.changed_at > now() - interval '14 days'
    and (coalesce(cardinality(sc.roster_ids), 0) = 0 or t.roster_id = any(sc.roster_ids))
    and sc.label <> 'Tryout'
  order by sc.old_date;
end $$;

-- Announcements for parents of this child's team, newest first.
create or replace function public.parent_announcements(p_player uuid)
returns table (id uuid, message text, coach_name text, is_pinned boolean, created_at timestamptz, read boolean)
language plpgsql stable security definer set search_path = public as $$
declare t record;
begin
  if not public._is_parent_of(p_player) then return; end if;
  select * into t from public._child_team(p_player);
  return query
  select a.id, a.message, a.coach_name, a.is_pinned, a.created_at,
         exists (select 1 from public.announcement_parent_reads r where r.announcement_id = a.id and r.parent_id = auth.uid())
  from public.announcements a
  where a.program_id = t.program_id and a.audience in ('parents', 'both')
    and (coalesce(cardinality(a.roster_ids), 0) = 0 or t.roster_id = any(a.roster_ids))
  order by a.is_pinned desc, a.created_at desc
  limit 30;
end $$;

create or replace function public.parent_mark_read(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'parent' then return; end if;
  insert into public.announcement_parent_reads (announcement_id, parent_id)
  select a.id, auth.uid() from public.announcements a
  where a.id = any(p_ids) and a.audience in ('parents', 'both')
    and exists (select 1 from public.family_links f join public.profiles p on p.id = f.player_id
                where f.parent_id = auth.uid() and f.status = 'active' and f.program_id = a.program_id
                  and (coalesce(cardinality(a.roster_ids), 0) = 0 or p.home_roster_id = any(a.roster_ids)))
  on conflict do nothing;
end $$;

-- ── 7. Absences ───────────────────────────────────────────────
-- p_items: [{kind, id}]. Only upcoming items on the child's own schedule.
-- Practices are marked absent-excused on Practice Day straight away
-- ("Parent: <reason>"); the coach can still change it there.
create or replace function public.report_absence(p_player uuid, p_items jsonb, p_reason text, p_note text default null)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  t record;
  it record;
  s record;
  ids uuid[] := '{}';
  new_id uuid;
  v_reason text := left(trim(coalesce(p_reason, '')), 40);
begin
  if not public._is_parent_of(p_player) then raise exception 'You can only report absences for your own child.'; end if;
  if v_reason = '' then raise exception 'Pick a reason.'; end if;
  select * into t from public._child_team(p_player);
  for it in select * from jsonb_to_recordset(p_items) as x(kind text, id uuid) loop
    select * into s from public.parent_schedule(p_player, 180) ps where ps.kind = it.kind and ps.id = it.id;
    if s.id is null then raise exception 'That isn''t on your child''s upcoming schedule.'; end if;
    insert into public.parent_absences (program_id, player_id, parent_id, item_kind, item_id, item_date, item_label, reason, note)
    values (t.program_id, p_player, auth.uid(), it.kind, it.id, s.item_date, s.title, v_reason, nullif(left(trim(coalesce(p_note, '')), 300), ''))
    on conflict (player_id, item_kind, item_id) do update
      set reason = excluded.reason, note = excluded.note, parent_id = excluded.parent_id, created_at = now(), seen_at = null
    returning id into new_id;
    ids := ids || new_id;
    if it.kind = 'practice' then
      insert into public.practice_attendance_overrides (program_id, practice_id, player_id, override_type, excused, reason)
      values (t.program_id, it.id, p_player, 'absent', true, 'Parent: ' || v_reason)
      on conflict (practice_id, player_id) do update
        set override_type = 'absent', excused = true, reason = excluded.reason
        where public.practice_attendance_overrides.override_type <> 'call_up';
    end if;
  end loop;
  return ids;
end $$;

-- A parent takes a report back (before the day).
create or replace function public.cancel_absence(p_player uuid, p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public._is_parent_of(p_player) then raise exception 'Not your child.'; end if;
  delete from public.parent_absences where player_id = p_player and item_id = p_item and item_date >= current_date;
  get diagnostics n = row_count;
  if n = 0 then return; end if;  -- nothing to undo, or it's already past
  delete from public.practice_attendance_overrides
  where practice_id = p_item and player_id = p_player and override_type = 'absent' and reason like 'Parent:%';
end $$;

-- ── 8. Invites and approval ───────────────────────────────────
-- A family invite link for a player. The player can make their own; a
-- coach can make one for any player in their program. Reuses a link
-- that's still good.
create or replace function public.create_family_invite(p_player uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid;
  v_tok text;
begin
  select m.program_id into v_pid from public.program_members m
  where m.user_id = p_player and m.role = 'player' and m.status = 'active'
    and (p_player = auth.uid() or public.is_program_staff(m.program_id, auth.uid()))
  order by (m.program_id = public.current_program_id()) desc
  limit 1;
  if v_pid is null then raise exception 'Only the player or their coach can make this link.'; end if;
  select token into v_tok from public.family_invites
  where player_id = p_player and program_id = v_pid and revoked_at is null and expires_at > now() + interval '7 days'
  order by created_at desc limit 1;
  if v_tok is null then
    v_tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.family_invites (token, program_id, player_id, created_by) values (v_tok, v_pid, p_player, auth.uid());
  end if;
  return v_tok;
end $$;

-- Coaches: approve or turn down a parent.
create or replace function public.decide_family_link(p_link uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare f public.family_links;
begin
  select * into f from public.family_links where id = p_link;
  if f.id is null or not public.is_program_staff(f.program_id, auth.uid()) then raise exception 'Only coaches can do that.'; end if;
  if p_approve then
    update public.family_links set status = 'active', approved_at = now(), approved_by = auth.uid() where id = p_link;
  else
    delete from public.family_links where id = p_link;
  end if;
end $$;

-- Coaches: "seen by 12 of 20 parents" for their announcements.
create or replace function public.announcement_parent_stats(p_ids uuid[])
returns table (announcement_id uuid, seen int, total int)
language sql stable security definer set search_path = public as $$
  select a.id,
         (select count(*) from public.announcement_parent_reads r where r.announcement_id = a.id)::int,
         (select count(distinct f.parent_id) from public.family_links f
          join public.profiles p on p.id = f.player_id
          where f.program_id = a.program_id and f.status = 'active'
            and (coalesce(cardinality(a.roster_ids), 0) = 0 or p.home_roster_id = any(a.roster_ids)))::int
  from public.announcements a
  where a.id = any(p_ids) and public.is_program_staff(a.program_id, auth.uid());
$$;


-- Coaches: the program's families. Parents aren't members of the program,
-- so their names and emails come through here, for staff only.
create or replace function public.staff_families()
returns table (link_id uuid, status text, relation text, created_at timestamptz, approved_at timestamptz,
               parent_id uuid, parent_name text, parent_email text,
               player_id uuid, player_name text, roster_id uuid, team_name text)
language sql stable security definer set search_path = public as $$
  select f.id, f.status, f.relation, f.created_at, f.approved_at,
         f.parent_id, pp.name, pe.email,
         f.player_id, kp.name, kp.home_roster_id, r.name
  from public.family_links f
  join public.profiles pp on pp.id = f.parent_id
  join public.profiles kp on kp.id = f.player_id
  left join public.profile_emails pe on pe.id = f.parent_id
  left join public.rosters r on r.id = kp.home_roster_id
  where f.program_id = public.current_program_id()
    and public.is_program_staff(f.program_id, auth.uid())
  order by f.status desc, kp.name, pp.name;
$$;

-- Coaches: absences families reported, from a week ago on.
create or replace function public.staff_absences(p_days_back int default 7)
returns table (id uuid, player_id uuid, player_name text, roster_id uuid, parent_name text,
               item_kind text, item_id uuid, item_date date, item_label text,
               reason text, note text, created_at timestamptz, seen_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.player_id, kp.name, kp.home_roster_id, pp.name,
         a.item_kind, a.item_id, a.item_date, a.item_label,
         a.reason, a.note, a.created_at, a.seen_at
  from public.parent_absences a
  join public.profiles kp on kp.id = a.player_id
  left join public.profiles pp on pp.id = a.parent_id
  where a.program_id = public.current_program_id()
    and public.is_program_staff(a.program_id, auth.uid())
    and a.item_date >= current_date - least(greatest(coalesce(p_days_back, 7), 0), 60)
  order by a.item_date, kp.name;
$$;

revoke all on function public._is_parent_of(uuid), public._child_team(uuid), public._log_schedule_change() from public, anon;
grant execute on function public.parent_children(), public.parent_schedule(uuid, int), public.parent_cancellations(uuid),
  public.parent_announcements(uuid), public.parent_mark_read(uuid[]), public.report_absence(uuid, jsonb, text, text),
  public.cancel_absence(uuid, uuid), public.create_family_invite(uuid), public.decide_family_link(uuid, boolean),
  public.announcement_parent_stats(uuid[]), public.staff_families(), public.staff_absences(int) to authenticated;
revoke execute on function public.parent_children(), public.parent_schedule(uuid, int), public.parent_cancellations(uuid),
  public.parent_announcements(uuid), public.parent_mark_read(uuid[]), public.report_absence(uuid, jsonb, text, text),
  public.cancel_absence(uuid, uuid), public.create_family_invite(uuid), public.decide_family_link(uuid, boolean),
  public.announcement_parent_stats(uuid[]), public.staff_families(), public.staff_absences(int) from anon;

-- ── 9. Check ──────────────────────────────────────────────────
select 'parent portal tables' as item, count(*)::text as value
from information_schema.tables
where table_schema = 'public'
  and table_name in ('family_links','family_invites','parent_absences','announcement_parent_reads','schedule_changes');
