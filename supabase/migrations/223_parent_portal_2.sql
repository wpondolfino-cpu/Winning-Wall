-- 223_parent_portal_2.sql
-- Parent portal, phase 2: checklist, sign-ups and family messages.
-- Run after 222_parent_portal.sql. Safe to run twice.
--
-- Same rule as phase 1: parents are never program members, so none of
-- these tables are open to them directly. They reach them only through the
-- functions below, which check that they're an approved parent of that
-- child and only return that child's team.
--
--   family_team_settings     per team: families may suggest sign-ups (on by
--                            default) and family messages (off by default)
--   family_checklist_items   coach-made items per team ("Physical form")
--   family_checklist_marks   coach ticks "received" per player; parents
--                            see "Received Dec 3", read-only
--   family_signups           sign-ups (team dinner, rides, volunteers).
--                            Made by coaches, or suggested by a family and
--                            approved by a coach
--   family_signup_spots      the spots, each with how many are needed
--   family_signup_claims     who signed up for what
--   family_signup_updates    the organizer's updates ("Moved to 6:30")
--   family_threads / family_messages / family_thread_reads
--                            one thread per family (per player) with the
--                            whole staff. Nothing can be edited or deleted.
--
-- Location on a sign-up: only coaches, the organizer and families who
-- signed up see it, and it's wiped 2 days after the event.

-- ── 1. Per-team switches ─────────────────────────────────────
create table if not exists public.family_team_settings (
  roster_id      uuid primary key references public.rosters(id) on delete cascade,
  program_id     uuid not null default public.current_program_id() references public.programs(id) on delete cascade,
  suggestions_on boolean not null default true,
  messages_on    boolean not null default false,
  updated_at     timestamptz not null default now()
);

create or replace function public._family_setting(p_roster uuid, p_which text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_which
    when 'suggestions' then coalesce((select s.suggestions_on from public.family_team_settings s where s.roster_id = p_roster), true)
    when 'messages'    then coalesce((select s.messages_on    from public.family_team_settings s where s.roster_id = p_roster), false)
    else false end;
$$;

-- ── 2. Checklist ─────────────────────────────────────────────
create table if not exists public.family_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null default public.current_program_id() references public.programs(id) on delete cascade,
  roster_id   uuid not null references public.rosters(id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 120),
  details     text check (details is null or length(details) <= 500),
  due_date    date,
  sort_order  int not null default 0,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists family_checklist_items_roster_idx on public.family_checklist_items (roster_id);

create table if not exists public.family_checklist_marks (
  item_id     uuid not null references public.family_checklist_items(id) on delete cascade,
  player_id   uuid not null references public.profiles(id) on delete cascade,
  program_id  uuid not null default public.current_program_id() references public.programs(id) on delete cascade,
  received_on date not null default current_date,
  marked_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  primary key (item_id, player_id)
);

-- ── 3. Sign-ups ──────────────────────────────────────────────
create table if not exists public.family_signups (
  id                  uuid primary key default gen_random_uuid(),
  program_id          uuid not null references public.programs(id) on delete cascade,
  roster_id           uuid references public.rosters(id) on delete cascade,   -- null = every team
  title               text not null check (length(btrim(title)) between 1 and 100),
  details             text check (details is null or length(details) <= 1000),
  event_date          date,
  event_time          time,
  deadline            date,             -- last day to sign up or back out; null = the event day
  show_names          boolean not null default true,
  allow_undo          boolean not null default true,
  status              text not null default 'open' check (status in ('pending', 'open', 'closed', 'declined')),
  organizer_id        uuid references public.profiles(id) on delete set null,
  organizer_is_parent boolean not null default false,
  organizer_player_id uuid references public.profiles(id) on delete set null,
  location            text check (location is null or length(location) <= 300),
  decline_note        text check (decline_note is null or length(decline_note) <= 300),
  approved_by         uuid references public.profiles(id) on delete set null,
  approved_at         timestamptz,
  last_reminded_at    timestamptz,
  created_at          timestamptz not null default now(),
  constraint family_signups_location_needs_date check (location is null or event_date is not null)
);
create index if not exists family_signups_program_idx on public.family_signups (program_id, status);

create table if not exists public.family_signup_spots (
  id         uuid primary key default gen_random_uuid(),
  signup_id  uuid not null references public.family_signups(id) on delete cascade,
  label      text not null check (length(btrim(label)) between 1 and 80),
  quantity   int not null default 1 check (quantity between 1 and 99),
  sort_order int not null default 0
);
create index if not exists family_signup_spots_signup_idx on public.family_signup_spots (signup_id);

create table if not exists public.family_signup_claims (
  id         uuid primary key default gen_random_uuid(),
  signup_id  uuid not null references public.family_signups(id) on delete cascade,
  spot_id    uuid not null references public.family_signup_spots(id) on delete cascade,
  parent_id  uuid not null references public.profiles(id) on delete cascade,
  player_id  uuid references public.profiles(id) on delete cascade,
  qty        int not null default 1 check (qty between 1 and 99),
  note       text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (spot_id, parent_id)
);
create index if not exists family_signup_claims_signup_idx on public.family_signup_claims (signup_id);

create table if not exists public.family_signup_updates (
  id         uuid primary key default gen_random_uuid(),
  signup_id  uuid not null references public.family_signups(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  message    text not null check (length(btrim(message)) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- ── 4. Family messages ───────────────────────────────────────
create table if not exists public.family_threads (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references public.programs(id) on delete cascade,
  player_id       uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  unique (program_id, player_id)
);

create table if not exists public.family_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.family_threads(id) on delete cascade,
  program_id  uuid not null references public.programs(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,
  author_kind text not null check (author_kind in ('parent', 'staff')),
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists family_messages_thread_idx on public.family_messages (thread_id, created_at);

create table if not exists public.family_thread_reads (
  thread_id uuid not null references public.family_threads(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- ── 5. Row rules ─────────────────────────────────────────────
-- Settings and checklist: staff of the program, directly. Everything else
-- goes through the functions below (no direct access at all).
alter table public.family_team_settings   enable row level security;
alter table public.family_checklist_items enable row level security;
alter table public.family_checklist_marks enable row level security;
alter table public.family_signups         enable row level security;
alter table public.family_signup_spots    enable row level security;
alter table public.family_signup_claims   enable row level security;
alter table public.family_signup_updates  enable row level security;
alter table public.family_threads         enable row level security;
alter table public.family_messages        enable row level security;
alter table public.family_thread_reads    enable row level security;

drop policy if exists family_team_settings_staff on public.family_team_settings;
create policy family_team_settings_staff on public.family_team_settings for all
  using (public.is_program_staff(program_id, auth.uid()))
  with check (public.is_program_staff(program_id, auth.uid())
              and exists (select 1 from public.rosters r where r.id = roster_id and r.program_id = family_team_settings.program_id));

drop policy if exists family_checklist_items_staff on public.family_checklist_items;
create policy family_checklist_items_staff on public.family_checklist_items for all
  using (public.is_program_staff(program_id, auth.uid()))
  with check (public.is_program_staff(program_id, auth.uid())
              and exists (select 1 from public.rosters r where r.id = roster_id and r.program_id = family_checklist_items.program_id));

drop policy if exists family_checklist_marks_staff on public.family_checklist_marks;
create policy family_checklist_marks_staff on public.family_checklist_marks for all
  using (public.is_program_staff(program_id, auth.uid()))
  with check (public.is_program_staff(program_id, auth.uid())
              and exists (select 1 from public.family_checklist_items i where i.id = item_id and i.program_id = family_checklist_marks.program_id));

-- Messages can never be changed or deleted from the app, by anyone.
revoke update, delete on public.family_messages from authenticated, anon;
revoke all on public.family_signups, public.family_signup_spots, public.family_signup_claims, public.family_signup_updates,
  public.family_threads, public.family_messages, public.family_thread_reads from anon;
grant select, insert, update, delete on public.family_team_settings, public.family_checklist_items, public.family_checklist_marks to authenticated;

-- ── 6. Helpers ───────────────────────────────────────────────
-- Is the caller on this program's staff (current program only)?
create or replace function public._staff_here(p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_program is not null and p_program = public.current_program_id() and public.is_program_staff(p_program, auth.uid());
$$;

-- Wipe sign-up locations 2 days after the event.
create or replace function public.purge_signup_locations()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.family_signups set location = null
  where location is not null and event_date < current_date - 2;
  get diagnostics n = row_count;
  return n;
end $$;

-- Can this parent see this sign-up through this child?
create or replace function public._signup_visible_to_parent(s public.family_signups, p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public._is_parent_of(p_player)
     and s.program_id = (select t.program_id from public._child_team(p_player) t)
     and (s.roster_id is null or s.roster_id = (select t.roster_id from public._child_team(p_player) t))
     and (s.status in ('open', 'closed') or s.organizer_id = auth.uid())
     and coalesce(s.event_date, (s.created_at at time zone 'utc')::date + 60) >= current_date - 2;
$$;

-- ── 7. Parent: what's on each tab ────────────────────────────
create or replace function public.parent_portal_info(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t record; th uuid;
begin
  if not public._is_parent_of(p_player) then return null; end if;
  select * into t from public._child_team(p_player);
  select id into th from public.family_threads where program_id = t.program_id and player_id = p_player;
  return jsonb_build_object(
    'messages_on',    public._family_setting(t.roster_id, 'messages'),
    'suggestions_on', public._family_setting(t.roster_id, 'suggestions'),
    'has_messages',   th is not null,
    'unread_messages', (select count(*) from public.family_messages m
                        where m.thread_id = th and m.author_id is distinct from auth.uid()
                          and m.created_at > coalesce((select r.read_at from public.family_thread_reads r where r.thread_id = th and r.user_id = auth.uid()), '-infinity')),
    'open_signups',   (select count(*) from public.family_signups s
                       where s.status = 'open' and public._signup_visible_to_parent(s, p_player)
                         and not exists (select 1 from public.family_signup_claims c where c.signup_id = s.id and c.parent_id = auth.uid())),
    'checklist_total',    (select count(*) from public.family_checklist_items i where i.roster_id = t.roster_id and i.archived_at is null),
    'checklist_received', (select count(*) from public.family_checklist_items i join public.family_checklist_marks k on k.item_id = i.id and k.player_id = p_player
                           where i.roster_id = t.roster_id and i.archived_at is null)
  );
end $$;

-- ── 8. Checklist (parents read-only) ─────────────────────────
create or replace function public.parent_checklist(p_player uuid)
returns table (id uuid, title text, details text, due_date date, received_on date)
language sql stable security definer set search_path = public as $$
  select i.id, i.title, i.details, i.due_date, k.received_on
  from public.family_checklist_items i
  left join public.family_checklist_marks k on k.item_id = i.id and k.player_id = p_player
  where public._is_parent_of(p_player)
    and i.roster_id = (select t.roster_id from public._child_team(p_player) t)
    and i.archived_at is null
  order by i.sort_order, i.due_date nulls last, i.created_at;
$$;

-- ── 9. Sign-ups ──────────────────────────────────────────────
-- Everything about the sign-ups one person can see, as JSON.
--   p_player given: a parent, through that child.
--   p_player null:  a coach, every sign-up in the program.
create or replace function public.signup_list(p_player uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  is_staff boolean := false;
  prog uuid;
  res jsonb;
begin
  perform public.purge_signup_locations();
  if p_player is null then
    prog := public.current_program_id();
    is_staff := public._staff_here(prog);
    if not is_staff then return '[]'::jsonb; end if;
  elsif not public._is_parent_of(p_player) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(x order by x->>'sort_date', x->>'created_at'), '[]'::jsonb) into res
  from (
    select jsonb_build_object(
      'id', s.id, 'roster_id', s.roster_id, 'team_name', r.name,
      'title', s.title, 'details', s.details,
      'event_date', s.event_date, 'event_time', s.event_time, 'deadline', s.deadline,
      'sort_date', coalesce(s.event_date, s.deadline, (s.created_at at time zone 'utc')::date)::text,
      'created_at', s.created_at,
      'show_names', s.show_names, 'allow_undo', s.allow_undo, 'status', s.status,
      'decline_note', s.decline_note,
      'organizer_name', op.name, 'organizer_is_parent', s.organizer_is_parent,
      'organizer_child', case when s.organizer_is_parent then oc.name end,
      'mine', s.organizer_id = auth.uid(),
      'can_manage', is_staff or s.organizer_id = auth.uid(),
      'open_now', s.status = 'open' and current_date <= coalesce(s.deadline, s.event_date, current_date),
      'location', case when is_staff or s.organizer_id = auth.uid()
                         or exists (select 1 from public.family_signup_claims c where c.signup_id = s.id and c.parent_id = auth.uid())
                       then s.location end,
      'has_location', s.location is not null,
      'spots', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', sp.id, 'label', sp.label, 'quantity', sp.quantity,
                  'taken', (select coalesce(sum(c.qty), 0) from public.family_signup_claims c where c.spot_id = sp.id),
                  'claims', (select coalesce(jsonb_agg(jsonb_build_object(
                               'id', c.id, 'qty', c.qty,
                               'mine', c.parent_id = auth.uid(),
                               'name', case when s.show_names or is_staff or s.organizer_id = auth.uid() or c.parent_id = auth.uid() then cp.name end,
                               'child', case when s.show_names or is_staff or s.organizer_id = auth.uid() or c.parent_id = auth.uid() then ck.name end,
                               'note', case when is_staff or s.organizer_id = auth.uid() or c.parent_id = auth.uid() then c.note end
                             ) order by c.created_at), '[]'::jsonb)
                             from public.family_signup_claims c
                             left join public.profiles cp on cp.id = c.parent_id
                             left join public.profiles ck on ck.id = c.player_id
                             where c.spot_id = sp.id)
                ) order by sp.sort_order, sp.label), '[]'::jsonb)
                from public.family_signup_spots sp where sp.signup_id = s.id),
      'updates', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'message', u.message, 'created_at', u.created_at, 'author', ua.name)
                                            order by u.created_at desc), '[]'::jsonb)
                  from public.family_signup_updates u left join public.profiles ua on ua.id = u.author_id
                  where u.signup_id = s.id)
    ) as x
    from public.family_signups s
    left join public.rosters r on r.id = s.roster_id
    left join public.profiles op on op.id = s.organizer_id
    left join public.profiles oc on oc.id = s.organizer_player_id
    where case when p_player is null
               then s.program_id = prog
                    and (s.status <> 'declined' or s.created_at > now() - interval '14 days')
                    and coalesce(s.event_date, (s.created_at at time zone 'utc')::date + 60) >= current_date - 7
               else public._signup_visible_to_parent(s, p_player) end
  ) q;
  return res;
end $$;

-- Make or edit a sign-up.
--   p: { id?, player?, roster_id?, title, details, event_date, event_time,
--        deadline, show_names, allow_undo, location,
--        spots: [{ id?, label, quantity }] }
-- A coach's sign-up opens right away. A family's (p.player = their child)
-- waits for a coach, and only if that team allows family suggestions.
create or replace function public.signup_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sid uuid := nullif(p->>'id', '')::uuid;
  kid uuid := nullif(p->>'player', '')::uuid;
  s public.family_signups;
  t record;
  prog uuid; roster uuid;
  staff boolean;
  sp jsonb; keep uuid[] := '{}'; v_spot uuid; n int := 0; taken int;
  v_title text := btrim(coalesce(p->>'title', ''));
  v_date date := nullif(p->>'event_date', '')::date;
  v_loc text := nullif(btrim(coalesce(p->>'location', '')), '');
begin
  if v_title = '' then raise exception 'Give the sign-up a name.'; end if;
  if jsonb_typeof(p->'spots') is distinct from 'array' or jsonb_array_length(p->'spots') = 0 then
    raise exception 'Add at least one spot.';
  end if;
  if jsonb_array_length(p->'spots') > 30 then raise exception 'That''s too many spots (30 max).'; end if;
  if v_loc is not null and v_date is null then raise exception 'Add the date so the location can be removed after the event.'; end if;

  if sid is null then
    if kid is not null then
      -- A family suggesting one.
      if not public._is_parent_of(kid) then raise exception 'Not your child.'; end if;
      select * into t from public._child_team(kid);
      if t.roster_id is null then raise exception 'Your player isn''t on a team yet.'; end if;
      if not public._family_setting(t.roster_id, 'suggestions') then
        raise exception 'This team''s coaches have turned off family sign-ups.';
      end if;
      insert into public.family_signups (program_id, roster_id, title, status, organizer_id, organizer_is_parent, organizer_player_id)
      values (t.program_id, t.roster_id, v_title, 'pending', auth.uid(), true, kid)
      returning * into s;
    else
      prog := public.current_program_id();
      if not public._staff_here(prog) then raise exception 'Only coaches can do that.'; end if;
      roster := nullif(p->>'roster_id', '')::uuid;
      if roster is not null and not exists (select 1 from public.rosters r where r.id = roster and r.program_id = prog) then
        raise exception 'That team isn''t in your program.';
      end if;
      insert into public.family_signups (program_id, roster_id, title, status, organizer_id, approved_by, approved_at)
      values (prog, roster, v_title, 'open', auth.uid(), auth.uid(), now())
      returning * into s;
    end if;
  else
    select * into s from public.family_signups where id = sid for update;
    if not found then raise exception 'That sign-up is gone.'; end if;
    staff := public._staff_here(s.program_id);
    if not staff and s.organizer_id is distinct from auth.uid() then raise exception 'Only the organizer or a coach can change this.'; end if;
    if not staff and s.status = 'declined' then raise exception 'A coach turned this one down.'; end if;
    if staff and not s.organizer_is_parent and p ? 'roster_id' then
      roster := nullif(p->>'roster_id', '')::uuid;
      if roster is not null and not exists (select 1 from public.rosters r where r.id = roster and r.program_id = s.program_id) then
        raise exception 'That team isn''t in your program.';
      end if;
      update public.family_signups set roster_id = roster where id = s.id;
    end if;
  end if;

  update public.family_signups set
    title      = v_title,
    details    = nullif(btrim(coalesce(p->>'details', '')), ''),
    event_date = v_date,
    event_time = nullif(p->>'event_time', '')::time,
    deadline   = nullif(p->>'deadline', '')::date,
    show_names = coalesce((p->>'show_names')::boolean, true),
    allow_undo = coalesce((p->>'allow_undo')::boolean, true),
    location   = v_loc
  where id = s.id;

  -- Spots: keep the ones sent, add new ones, remove the rest (only if
  -- nobody signed up for them). A spot can't shrink below what's taken.
  for sp in select * from jsonb_array_elements(p->'spots') loop
    n := n + 1;
    if btrim(coalesce(sp->>'label', '')) = '' then raise exception 'Every spot needs a name.'; end if;
    v_spot := nullif(sp->>'id', '')::uuid;
    if v_spot is not null and exists (select 1 from public.family_signup_spots x where x.id = v_spot and x.signup_id = s.id) then
      select coalesce(sum(c.qty), 0) into taken from public.family_signup_claims c where c.spot_id = v_spot;
      if coalesce((sp->>'quantity')::int, 1) < taken then
        raise exception '"%" already has % signed up. It can''t need fewer than that.', btrim(sp->>'label'), taken;
      end if;
      update public.family_signup_spots
        set label = btrim(sp->>'label'), quantity = greatest(1, least(99, coalesce((sp->>'quantity')::int, 1))), sort_order = n
        where id = v_spot;
    else
      insert into public.family_signup_spots (signup_id, label, quantity, sort_order)
      values (s.id, btrim(sp->>'label'), greatest(1, least(99, coalesce((sp->>'quantity')::int, 1))), n)
      returning id into v_spot;
    end if;
    keep := keep || v_spot;
  end loop;
  if exists (select 1 from public.family_signup_spots x
             where x.signup_id = s.id and not (x.id = any(keep))
               and exists (select 1 from public.family_signup_claims c where c.spot_id = x.id)) then
    raise exception 'A spot you removed already has people signed up. Take them off first.';
  end if;
  delete from public.family_signup_spots x where x.signup_id = s.id and not (x.id = any(keep));

  select * into s from public.family_signups where id = s.id;
  return jsonb_build_object('id', s.id, 'status', s.status);
end $$;

-- A coach approves or turns down a family's suggestion.
create or replace function public.signup_decide(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.family_signups;
begin
  select * into s from public.family_signups where id = p_id for update;
  if not found or not public._staff_here(s.program_id) then raise exception 'Only coaches can do that.'; end if;
  if s.status <> 'pending' then raise exception 'That one was already decided.'; end if;
  if p_approve then
    update public.family_signups set status = 'open', approved_by = auth.uid(), approved_at = now(), decline_note = null where id = p_id;
  else
    update public.family_signups set status = 'declined', decline_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
  end if;
end $$;

-- Organizer or coach: stop or restart sign-ups.
create or replace function public.signup_set_open(p_id uuid, p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s public.family_signups;
begin
  select * into s from public.family_signups where id = p_id for update;
  if not found or not (public._staff_here(s.program_id) or s.organizer_id = auth.uid()) then
    raise exception 'Only the organizer or a coach can do that.';
  end if;
  if s.status not in ('open', 'closed') then raise exception 'It isn''t approved yet.'; end if;
  update public.family_signups set status = case when p_open then 'open' else 'closed' end where id = p_id;
end $$;

-- A coach removes a sign-up; a family can withdraw their own suggestion
-- before it's approved.
create or replace function public.signup_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.family_signups;
begin
  select * into s from public.family_signups where id = p_id;
  if not found then return; end if;
  if not (public._staff_here(s.program_id) or (s.organizer_id = auth.uid() and s.status in ('pending', 'declined'))) then
    raise exception 'Only a coach can remove this.';
  end if;
  delete from public.family_signups where id = p_id;
end $$;

-- A family signs up for a spot (or changes how many / their note).
create or replace function public.signup_claim(p_spot uuid, p_player uuid, p_qty int default 1, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sp public.family_signup_spots; s public.family_signups; taken int; cid uuid; q int := greatest(1, least(99, coalesce(p_qty, 1)));
begin
  select * into sp from public.family_signup_spots where id = p_spot for update;
  if not found then raise exception 'That spot is gone.'; end if;
  select * into s from public.family_signups where id = sp.signup_id;
  if not public._signup_visible_to_parent(s, p_player) then raise exception 'Not available to you.'; end if;
  if s.status <> 'open' then raise exception 'Sign-ups are closed.'; end if;
  if current_date > coalesce(s.deadline, s.event_date, current_date) then raise exception 'The sign-up deadline has passed.'; end if;
  select coalesce(sum(c.qty), 0) into taken from public.family_signup_claims c where c.spot_id = p_spot and c.parent_id <> auth.uid();
  if taken + q > sp.quantity then
    if sp.quantity - taken <= 0 then raise exception 'That spot is full.'; end if;
    raise exception 'Only % left for that spot.', sp.quantity - taken;
  end if;
  insert into public.family_signup_claims (signup_id, spot_id, parent_id, player_id, qty, note)
  values (s.id, p_spot, auth.uid(), p_player, q, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (spot_id, parent_id) do update set qty = excluded.qty, note = excluded.note, player_id = excluded.player_id
  returning id into cid;
  return cid;
end $$;

-- Back out (family, until the deadline, if the sign-up allows it), or take
-- someone off (organizer or coach, any time).
create or replace function public.signup_unclaim(p_claim uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.family_signup_claims; s public.family_signups;
begin
  select * into c from public.family_signup_claims where id = p_claim;
  if not found then return; end if;
  select * into s from public.family_signups where id = c.signup_id;
  if public._staff_here(s.program_id) or s.organizer_id = auth.uid() then
    delete from public.family_signup_claims where id = p_claim; return;
  end if;
  if c.parent_id <> auth.uid() then raise exception 'That isn''t yours.'; end if;
  if not s.allow_undo then raise exception 'This sign-up can''t be undone. Ask the organizer or a coach to take you off.'; end if;
  if current_date > coalesce(s.deadline, s.event_date, current_date) then raise exception 'The deadline has passed. Ask the organizer or a coach to take you off.'; end if;
  delete from public.family_signup_claims where id = p_claim;
end $$;

-- The organizer (or a coach) posts an update to everyone who signed up.
create or replace function public.signup_post_update(p_id uuid, p_message text)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.family_signups; uid uuid;
begin
  select * into s from public.family_signups where id = p_id;
  if not found or not (public._staff_here(s.program_id) or s.organizer_id = auth.uid()) then
    raise exception 'Only the organizer or a coach can post updates.';
  end if;
  if s.status not in ('open', 'closed') then raise exception 'It isn''t approved yet.'; end if;
  insert into public.family_signup_updates (signup_id, author_id, message)
  values (p_id, auth.uid(), left(btrim(coalesce(p_message, '')), 1000)) returning id into uid;
  return uid;
end $$;

-- ── 10. Family messages ──────────────────────────────────────
-- Can the caller use this child's thread? Returns the program, or null.
create or replace function public._thread_access(p_player uuid, out program_id uuid, out roster_id uuid, out kind text)
language plpgsql stable security definer set search_path = public as $$
declare t record;
begin
  if public._is_parent_of(p_player) then
    select * into t from public._child_team(p_player);
    program_id := t.program_id; roster_id := t.roster_id; kind := 'parent'; return;
  end if;
  select m.program_id, p.home_roster_id into t
  from public.program_members m join public.profiles p on p.id = m.user_id
  where m.user_id = p_player and m.status = 'active' and m.program_id = public.current_program_id();
  if found and public._staff_here(t.program_id) then
    program_id := t.program_id; roster_id := t.home_roster_id; kind := 'staff';
  end if;
end $$;

create or replace function public.family_thread_messages(p_player uuid)
returns table (id uuid, author_id uuid, author_name text, author_kind text, body text, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path = public as $$
declare a record; th uuid;
begin
  select * into a from public._thread_access(p_player);
  if a.program_id is null then return; end if;
  select f.id into th from public.family_threads f where f.program_id = a.program_id and f.player_id = p_player;
  if th is null then return; end if;
  insert into public.family_thread_reads (thread_id, user_id, read_at) values (th, auth.uid(), now())
  on conflict (thread_id, user_id) do update set read_at = now();
  return query
    select * from (
      select m.id, m.author_id, m.author_name, m.author_kind, m.body, m.created_at, m.author_id = auth.uid()
      from public.family_messages m where m.thread_id = th
      order by m.created_at desc limit 300
    ) z order by z.created_at;
end $$;

create or replace function public.family_send_message(p_player uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a record; th uuid; mid uuid; nm text; b text := btrim(coalesce(p_body, ''));
begin
  if b = '' then raise exception 'Type a message.'; end if;
  if length(b) > 2000 then raise exception 'That message is too long (2000 characters max).'; end if;
  select * into a from public._thread_access(p_player);
  if a.program_id is null then raise exception 'You can''t message about this player.'; end if;
  if not public._family_setting(a.roster_id, 'messages') then
    raise exception 'Messages are turned off for this team.';
  end if;
  insert into public.family_threads (program_id, player_id) values (a.program_id, p_player)
  on conflict (program_id, player_id) do nothing;
  select f.id into th from public.family_threads f where f.program_id = a.program_id and f.player_id = p_player;
  select p.name into nm from public.profiles p where p.id = auth.uid();
  insert into public.family_messages (thread_id, program_id, author_id, author_name, author_kind, body)
  values (th, a.program_id, auth.uid(), nm, a.kind, b) returning id into mid;
  update public.family_threads set last_message_at = now() where id = th;
  insert into public.family_thread_reads (thread_id, user_id, read_at) values (th, auth.uid(), now())
  on conflict (thread_id, user_id) do update set read_at = now();
  return mid;
end $$;

-- Coaches: every family (players with an approved parent), latest first.
create or replace function public.staff_family_threads()
returns table (player_id uuid, player_name text, roster_id uuid, team_name text, parents text,
               messages_on boolean, last_message_at timestamptz, last_body text, last_kind text, unread int)
language sql stable security definer set search_path = public as $$
  with kids as (
    select f.player_id, string_agg(pp.name, ', ' order by pp.name) as parents
    from public.family_links f join public.profiles pp on pp.id = f.parent_id
    where f.program_id = public.current_program_id() and f.status = 'active'
    group by f.player_id
  )
  select k.player_id, kp.name, kp.home_roster_id, r.name, k.parents,
         public._family_setting(kp.home_roster_id, 'messages'),
         th.last_message_at,
         (select left(m.body, 120) from public.family_messages m where m.thread_id = th.id order by m.created_at desc limit 1),
         (select m.author_kind from public.family_messages m where m.thread_id = th.id order by m.created_at desc limit 1),
         (select count(*)::int from public.family_messages m
          where m.thread_id = th.id and m.author_kind = 'parent'
            and m.created_at > coalesce((select rd.read_at from public.family_thread_reads rd where rd.thread_id = th.id and rd.user_id = auth.uid()), '-infinity'))
  from kids k
  join public.profiles kp on kp.id = k.player_id
  left join public.rosters r on r.id = kp.home_roster_id
  left join public.family_threads th on th.program_id = public.current_program_id() and th.player_id = k.player_id
  where public._staff_here(public.current_program_id())
  order by th.last_message_at desc nulls last, kp.name;
$$;

-- ── 11. Clean-up job (if pg_cron is turned on) ───────────────
-- Locations are also wiped whenever anyone opens sign-ups, so this is a
-- backup. Turn on pg_cron under Database → Extensions to use it.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-signup-locations';
    perform cron.schedule('purge-signup-locations', '15 4 * * *', 'select public.purge_signup_locations()');
  end if;
exception when others then
  raise notice 'pg_cron job not set up: %', sqlerrm;
end $$;

-- ── 12. Who can call what ────────────────────────────────────
revoke all on function public._family_setting(uuid, text), public._staff_here(uuid),
  public._signup_visible_to_parent(public.family_signups, uuid), public._thread_access(uuid),
  public.purge_signup_locations() from public, anon, authenticated;
grant execute on function public.parent_portal_info(uuid), public.parent_checklist(uuid),
  public.signup_list(uuid), public.signup_save(jsonb), public.signup_decide(uuid, boolean, text),
  public.signup_set_open(uuid, boolean), public.signup_delete(uuid), public.signup_claim(uuid, uuid, int, text),
  public.signup_unclaim(uuid), public.signup_post_update(uuid, text),
  public.family_thread_messages(uuid), public.family_send_message(uuid, text), public.staff_family_threads() to authenticated;
revoke execute on function public.parent_portal_info(uuid), public.parent_checklist(uuid),
  public.signup_list(uuid), public.signup_save(jsonb), public.signup_decide(uuid, boolean, text),
  public.signup_set_open(uuid, boolean), public.signup_delete(uuid), public.signup_claim(uuid, uuid, int, text),
  public.signup_unclaim(uuid), public.signup_post_update(uuid, text),
  public.family_thread_messages(uuid), public.family_send_message(uuid, text), public.staff_family_threads() from anon, public;

-- ── 13. Check ────────────────────────────────────────────────
select 'parent portal 2 tables' as item, count(*)::text as value
from information_schema.tables
where table_schema = 'public'
  and table_name in ('family_team_settings','family_checklist_items','family_checklist_marks','family_signups',
                     'family_signup_spots','family_signup_claims','family_signup_updates',
                     'family_threads','family_messages','family_thread_reads');
