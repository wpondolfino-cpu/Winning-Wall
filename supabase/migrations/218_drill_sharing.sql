-- ============================================================
-- 218_drill_sharing.sql
--
-- Coaches can send a team drill to another team.
--
--   * Teams at the same school: pick them from a list. Their coaches see
--     "New from Boys Basketball: Intro to Blob 1" in their Drill Library
--     with Add to library / No thanks.
--   * A coach at another school: a share code (DRL-7K4Q) good for 14 days,
--     which they type into their Drill Library. No list of other schools'
--     coaches is ever shown.
--
-- Adding makes the receiving team their own copy — description, tags,
-- diagram and linked play included (the Shared Library's copy, so 216
-- must be run first). Their copy is theirs; yours never changes.
--
-- Everything goes through the functions below; the two tables are closed
-- to direct reads and writes.
--
-- Safe to run more than once.
-- ============================================================


-- ── 1. Tables ────────────────────────────────────────────────
create table if not exists public.drill_sends (
  id           uuid primary key default gen_random_uuid(),
  drill_id     uuid not null references public.practice_drills_library(id) on delete cascade,
  from_program uuid not null references public.programs(id) on delete cascade,
  from_user    uuid,
  -- A team at the same school, or null for a share code.
  to_program   uuid references public.programs(id) on delete cascade,
  code         text unique,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  check ((to_program is null) <> (code is null))
);
create index if not exists drill_sends_to_program on public.drill_sends (to_program) where to_program is not null;
create index if not exists drill_sends_drill on public.drill_sends (drill_id);

-- A team's answer to a send: added (with the copy it made) or no thanks.
create table if not exists public.drill_send_picks (
  send_id    uuid not null references public.drill_sends(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  status     text not null check (status in ('added', 'dismissed')),
  copy_id    uuid,
  by_user    uuid,
  at         timestamptz not null default now(),
  primary key (send_id, program_id)
);

alter table public.drill_sends enable row level security;
alter table public.drill_send_picks enable row level security;
revoke all on public.drill_sends, public.drill_send_picks from anon, authenticated;


-- ── 2. Who you can send to: the other teams at your school ───
create or replace function public.drill_send_targets()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public.current_program_id();
begin
  if v_pid is null or not public.is_program_staff(v_pid, auth.uid()) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name)
      from public.programs p
      join public.programs me on me.id = v_pid
     where p.organization_id = me.organization_id
       and p.id <> v_pid
       and p.is_active
       and p.id is distinct from public.library_program_id()
       and not public.is_sandbox_program(p.id)), '[]'::jsonb);
end $$;


-- ── 3. Send to teams at your school ──────────────────────────
create or replace function public.drill_send(p_drill uuid, p_programs uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  v_from uuid;
  v_org  uuid;
  t      uuid;
  n      int := 0;
begin
  select program_id into v_from from public.practice_drills_library where id = p_drill;
  if v_from is null then raise exception 'Couldn''t find that drill.'; end if;
  if not public.is_program_staff(v_from, auth.uid()) then
    raise exception 'Only a coach on this team can send its drills.' using errcode = '42501';
  end if;
  select organization_id into v_org from public.programs where id = v_from;
  foreach t in array coalesce(p_programs, '{}') loop
    if t = v_from or not exists (select 1 from public.programs where id = t and organization_id = v_org and is_active) then
      raise exception 'You can only send to teams at your school.' using errcode = '42501';
    end if;
    -- Sent again before they answered: it just moves back to the top.
    update public.drill_sends set created_at = now(), from_user = auth.uid()
     where drill_id = p_drill and to_program = t
       and not exists (select 1 from public.drill_send_picks k where k.send_id = drill_sends.id);
    if not found then
      insert into public.drill_sends (drill_id, from_program, from_user, to_program)
      values (p_drill, v_from, auth.uid(), t);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;


-- ── 4. Share codes, for a coach at another school ────────────
create or replace function public.drill_share_code(p_drill uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from uuid;
  v_code text;
  v_exp  timestamptz;
  abc    text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- no 0/O or 1/I
begin
  select program_id into v_from from public.practice_drills_library where id = p_drill;
  if v_from is null then raise exception 'Couldn''t find that drill.'; end if;
  if not public.is_program_staff(v_from, auth.uid()) then
    raise exception 'Only a coach on this team can share its drills.' using errcode = '42501';
  end if;
  -- One live code per drill: asking again hands back the same one.
  select code, expires_at into v_code, v_exp from public.drill_sends
   where drill_id = p_drill and code is not null and revoked_at is null and expires_at > now()
   order by created_at desc limit 1;
  if v_code is null then
    loop
      v_code := 'DRL-' || (select string_agg(substr(abc, 1 + floor(random() * length(abc))::int, 1), '') from generate_series(1, 4));
      exit when not exists (select 1 from public.drill_sends where code = v_code);
    end loop;
    v_exp := now() + interval '14 days';
    insert into public.drill_sends (drill_id, from_program, from_user, code, expires_at)
    values (p_drill, v_from, auth.uid(), v_code, v_exp);
  end if;
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;

-- Turn a drill's code off before it runs out.
create or replace function public.drill_share_revoke(p_drill uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_from uuid;
begin
  select program_id into v_from from public.practice_drills_library where id = p_drill;
  if v_from is null or not public.is_program_staff(v_from, auth.uid()) then
    raise exception 'Only a coach on this team can do that.' using errcode = '42501';
  end if;
  update public.drill_sends set revoked_at = now()
   where drill_id = p_drill and code is not null and revoked_at is null;
end $$;

-- The live code for a drill, if there is one (shown on the card).
create or replace function public.drill_share_status(p_drill uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from uuid; r record;
begin
  select program_id into v_from from public.practice_drills_library where id = p_drill;
  if v_from is null or not public.is_program_staff(v_from, auth.uid()) then return null; end if;
  select code, expires_at into r from public.drill_sends
   where drill_id = p_drill and code is not null and revoked_at is null and expires_at > now()
   order by created_at desc limit 1;
  if r.code is null then return null; end if;
  return jsonb_build_object('code', r.code, 'expires_at', r.expires_at);
end $$;


-- ── 5. Receiving ─────────────────────────────────────────────
-- What's been sent to your team and not yet answered.
create or replace function public.drill_inbox()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public.current_program_id();
begin
  if v_pid is null or not public.is_program_staff(v_pid, auth.uid()) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'title', d.title, 'category', d.category_name,
             'from', fp.name, 'sent_at', s.created_at) order by s.created_at desc)
      from public.drill_sends s
      join public.practice_drills_library d on d.id = s.drill_id
      join public.programs fp on fp.id = s.from_program
     where s.to_program = v_pid
       and not exists (select 1 from public.drill_send_picks k where k.send_id = s.id and k.program_id = v_pid)),
    '[]'::jsonb);
end $$;

-- Make the copy (shared by "Add to library" and "Add from a code").
create or replace function public._drill_send_take(p_send uuid, p_pid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.drill_sends%rowtype; v_copy uuid; v_title text;
begin
  select * into s from public.drill_sends where id = p_send;
  v_copy := public._lib_copy_team_drill(s.drill_id, p_pid, auth.uid());
  if v_copy is null then raise exception 'That drill is no longer there to copy.'; end if;
  insert into public.drill_send_picks (send_id, program_id, status, copy_id, by_user)
  values (p_send, p_pid, 'added', v_copy, auth.uid())
  on conflict (send_id, program_id) do update
    set status = 'added', copy_id = excluded.copy_id, by_user = excluded.by_user, at = now();
  select title into v_title from public.practice_drills_library where id = v_copy;
  return jsonb_build_object('copy_id', v_copy, 'title', v_title);
end $$;
revoke all on function public._drill_send_take(uuid, uuid) from public, anon, authenticated;

-- Answer a send from a team at your school.
create or replace function public.drill_pick(p_send uuid, p_add boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pid uuid := public.current_program_id();
begin
  if v_pid is null or not public.is_program_staff(v_pid, auth.uid()) then
    raise exception 'Only a coach on this team can add drills.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.drill_sends where id = p_send and to_program = v_pid) then
    raise exception 'That drill wasn''t sent to this team.' using errcode = '42501';
  end if;
  if p_add then return public._drill_send_take(p_send, v_pid); end if;
  insert into public.drill_send_picks (send_id, program_id, status, by_user)
  values (p_send, v_pid, 'dismissed', auth.uid())
  on conflict (send_id, program_id) do update set status = 'dismissed', by_user = excluded.by_user, at = now();
  return jsonb_build_object('dismissed', true);
end $$;

-- What a code is for, before adding it.
create or replace function public.drill_code_lookup(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public.current_program_id(); r record;
begin
  if v_pid is null or not public.is_program_staff(v_pid, auth.uid()) then
    raise exception 'Only coaches can add drills from a code.' using errcode = '42501';
  end if;
  select s.id, s.expires_at, s.revoked_at, s.from_program, d.title, d.category_name, fp.name as from_name
    into r
    from public.drill_sends s
    join public.practice_drills_library d on d.id = s.drill_id
    join public.programs fp on fp.id = s.from_program
   where s.code = upper(trim(p_code));
  if r.id is null then return jsonb_build_object('ok', false, 'why', 'No drill has that code. Check it and try again.'); end if;
  if r.revoked_at is not null or r.expires_at <= now() then
    return jsonb_build_object('ok', false, 'why', 'That code has expired. Ask the coach for a new one.');
  end if;
  if r.from_program = v_pid then return jsonb_build_object('ok', false, 'why', 'That drill is already your team''s.'); end if;
  return jsonb_build_object('ok', true, 'title', r.title, 'category', r.category_name, 'from', r.from_name);
end $$;

-- Add a drill from a code.
create or replace function public.drill_code_add(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pid uuid := public.current_program_id(); s public.drill_sends%rowtype;
begin
  if v_pid is null or not public.is_program_staff(v_pid, auth.uid()) then
    raise exception 'Only coaches can add drills from a code.' using errcode = '42501';
  end if;
  select * into s from public.drill_sends where code = upper(trim(p_code));
  if s.id is null then raise exception 'No drill has that code. Check it and try again.'; end if;
  if s.revoked_at is not null or s.expires_at <= now() then raise exception 'That code has expired. Ask the coach for a new one.'; end if;
  if s.from_program = v_pid then raise exception 'That drill is already your team''s.'; end if;
  return public._drill_send_take(s.id, v_pid);
end $$;


-- ── 6. Who can call what ─────────────────────────────────────
revoke all on function public.drill_send_targets(), public.drill_send(uuid, uuid[]), public.drill_share_code(uuid),
  public.drill_share_revoke(uuid), public.drill_share_status(uuid), public.drill_inbox(), public.drill_pick(uuid, boolean),
  public.drill_code_lookup(text), public.drill_code_add(text) from public, anon;
grant execute on function public.drill_send_targets(), public.drill_send(uuid, uuid[]), public.drill_share_code(uuid),
  public.drill_share_revoke(uuid), public.drill_share_status(uuid), public.drill_inbox(), public.drill_pick(uuid, boolean),
  public.drill_code_lookup(text), public.drill_code_add(text) to authenticated;
