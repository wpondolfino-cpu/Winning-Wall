-- ============================================================
-- 191_platform_messages.sql
--
-- MESSAGES between each program's head coaches and the platform admin.
-- One conversation per program. Only that program's head coaches and the
-- platform admin can read or write it; assistant coaches and players never
-- see it. The platform admin can start a conversation; head coaches can
-- message from Settings.
--
--   platform_messages      the messages (program, sender, from_platform)
--   platform_message_reads when each person last read each conversation
--   message_send(p, body)  send (head coach of p, or platform admin)
--   message_thread(p)      read a conversation (and mark it read)
--   message_inbox()        platform admin: every conversation, unread first
--   message_unread()       how many unread for me (badge)
--   message_recipients(p)  who a new message should notify
--
-- Also: platform_home() gains unread_messages.
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Tables ────────────────────────────────────────────────
create table if not exists public.platform_messages (
  id            bigint generated always as identity primary key,
  program_id    uuid not null references public.programs(id) on delete cascade,
  sender_id     uuid references public.profiles(id) on delete set null,
  from_platform boolean not null default false,
  body          text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at    timestamptz not null default now()
);
create index if not exists platform_messages_program_idx on public.platform_messages (program_id, created_at desc);

create table if not exists public.platform_message_reads (
  program_id uuid not null references public.programs(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (program_id, user_id)
);

alter table public.platform_messages enable row level security;
alter table public.platform_message_reads enable row level security;

-- Read: platform admin, or a head coach of that program. Writes go
-- through message_send() only.
drop policy if exists "messages_read" on public.platform_messages;
create policy "messages_read" on public.platform_messages for select to authenticated
  using (public.is_platform_admin(auth.uid())
         or coalesce(public.program_role(program_id, auth.uid()) = 'head_coach', false));
drop policy if exists "message_reads_own" on public.platform_message_reads;
create policy "message_reads_own" on public.platform_message_reads for select to authenticated
  using (user_id = auth.uid());

revoke all on public.platform_messages, public.platform_message_reads from anon;
grant select on public.platform_messages, public.platform_message_reads to authenticated;


-- ── 2. Send ──────────────────────────────────────────────────
create or replace function public.message_send(p_program uuid, p_body text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_platform boolean := public.is_platform_admin(v_me);
  v_id bigint;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not v_platform and coalesce(public.program_role(p_program, v_me), '') <> 'head_coach' then
    raise exception 'Only the program''s head coaches can message Winning Wall.' using errcode = '42501';
  end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message first.'; end if;
  insert into public.platform_messages (program_id, sender_id, from_platform, body)
  values (p_program, v_me, v_platform, trim(p_body))
  returning id into v_id;
  insert into public.platform_message_reads (program_id, user_id, read_at) values (p_program, v_me, now())
  on conflict (program_id, user_id) do update set read_at = now();
  return v_id;
end;
$function$;


-- ── 3. Read a conversation (and mark it read) ────────────────
create or replace function public.message_thread(p_program uuid)
 returns table(id bigint, from_platform boolean, sender_name text, body text, created_at timestamptz, mine boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid();
begin
  if not (public.is_platform_admin(v_me) or coalesce(public.program_role(p_program, v_me), '') = 'head_coach') then
    raise exception 'You can''t see that conversation.' using errcode = '42501';
  end if;
  insert into public.platform_message_reads (program_id, user_id, read_at) values (p_program, v_me, now())
  on conflict (program_id, user_id) do update set read_at = now();
  return query
    select m.id, m.from_platform,
           case when m.from_platform then 'Winning Wall' else coalesce(p.name, 'Coach') end,
           m.body, m.created_at, m.sender_id = v_me
      from public.platform_messages m
      left join public.profiles p on p.id = m.sender_id
     where m.program_id = p_program
     order by m.created_at, m.id
     limit 500;
end;
$function$;


-- ── 4. Platform admin inbox ──────────────────────────────────
create or replace function public.message_inbox()
 returns table(program_id uuid, program text, org text, last_body text, last_at timestamptz, last_from_platform boolean, unread integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid();
begin
  if not public.is_platform_admin(v_me) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return query
    select pr.id, pr.name, o.name, l.body, l.created_at, l.from_platform,
           (select count(*)::int from public.platform_messages m
             where m.program_id = pr.id and not m.from_platform
               and m.created_at > coalesce((select r.read_at from public.platform_message_reads r
                                            where r.program_id = pr.id and r.user_id = v_me), '-infinity'))
      from public.programs pr
      join public.organizations o on o.id = pr.organization_id
      join lateral (select m.body, m.created_at, m.from_platform from public.platform_messages m
                     where m.program_id = pr.id order by m.created_at desc, m.id desc limit 1) l on true
     order by 7 desc, l.created_at desc;
end;
$function$;


-- ── 5. Unread count (badges) ─────────────────────────────────
-- Platform admin: unread from coaches across every program.
-- Head coach: unread from Winning Wall in the program they're in.
create or replace function public.message_unread()
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_pid uuid := public.current_program_id();
begin
  if v_me is null then return 0; end if;
  if public.is_platform_admin(v_me) then
    return (select count(*)::int from public.platform_messages m
             where not m.from_platform
               and m.created_at > coalesce((select r.read_at from public.platform_message_reads r
                                            where r.program_id = m.program_id and r.user_id = v_me), '-infinity'));
  end if;
  if v_pid is null or coalesce(public.program_role(v_pid, v_me), '') <> 'head_coach' then return 0; end if;
  return (select count(*)::int from public.platform_messages m
           where m.program_id = v_pid and m.from_platform
             and m.created_at > coalesce((select r.read_at from public.platform_message_reads r
                                          where r.program_id = v_pid and r.user_id = v_me), '-infinity'));
end;
$function$;


-- ── 6. Who to notify about a new message ─────────────────────
-- From the platform admin -> that program's head coaches.
-- From a head coach -> the platform admin(s).
create or replace function public.message_recipients(p_program uuid)
 returns setof uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid();
begin
  if public.is_platform_admin(v_me) then
    return query select m.user_id from public.program_members m
                  where m.program_id = p_program and m.role = 'head_coach' and m.status = 'active'
                    and not coalesce(m.is_test, false) and m.user_id <> v_me;
  elsif coalesce(public.program_role(p_program, v_me), '') = 'head_coach' then
    return query select a.user_id from public.platform_admins a where a.user_id <> v_me;
  end if;
end;
$function$;


-- ── 7. Home shows unread messages ────────────────────────────
do $$
declare src text;
begin
  select pg_get_functiondef('public.platform_home()'::regprocedure) into src;
  if position('unread_messages' in src) = 0 then
    src := replace(src, '''recent'', coalesce((',
                   '''unread_messages'', public.message_unread(),' || chr(10) || '    ''recent'', coalesce((');
    execute src;
  end if;
end $$;


-- ── 8. Who can call these ────────────────────────────────────
revoke all on function public.message_send(uuid, text) from public, anon;
revoke all on function public.message_thread(uuid) from public, anon;
revoke all on function public.message_inbox() from public, anon;
revoke all on function public.message_unread() from public, anon;
revoke all on function public.message_recipients(uuid) from public, anon;
grant execute on function public.message_send(uuid, text) to authenticated;
grant execute on function public.message_thread(uuid) to authenticated;
grant execute on function public.message_inbox() to authenticated;
grant execute on function public.message_unread() to authenticated;
grant execute on function public.message_recipients(uuid) to authenticated;

commit;


-- ── Check ─────────────────────────────────────────────────────
select 'message tables' as item, (select count(*)::text from pg_tables where schemaname = 'public'
         and tablename in ('platform_messages', 'platform_message_reads')) || ' of 2' as value
union all
select 'home shows unread', case when pg_get_functiondef('public.platform_home()'::regprocedure) like '%unread_messages%' then 'yes' else 'NO' end;
