-- ============================================================
-- 192_message_inbox.sql
--
-- MESSAGES become an email-style inbox (replaces 191's one-thread-per-
-- program). Same people: a program's head coaches <-> the platform admin.
--
--   * Conversations have a subject; a program can have many.
--   * Delete a conversation = it leaves YOUR inbox only (the other side
--     keeps it). A new reply brings it back.
--   * Delete a message = only one you sent; it's removed for both sides.
--   * Unread is tracked per conversation, per person.
--
-- Existing 191 messages are kept: each program's messages become one
-- conversation called "Messages".
--
-- Functions (all check who's asking):
--   conv_inbox()                 my conversations (platform admin: all
--                                programs; head coach: the program I'm in)
--   conv_messages(c)             a conversation's messages; marks it read
--   conv_start(p, subject, body) new conversation in program p
--   conv_reply(c, body)          reply
--   conv_delete(c)               remove from my inbox
--   message_delete(id)           delete a message I sent
--   conv_recipients(c)           who to push a new message to
--   message_unread()             unread count for badges
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Conversations ─────────────────────────────────────────
create table if not exists public.platform_conversations (
  id         bigint generated always as identity primary key,
  program_id uuid not null references public.programs(id) on delete cascade,
  subject    text not null check (length(trim(subject)) > 0 and length(subject) <= 140),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_at    timestamptz not null default now()
);
create index if not exists platform_conversations_program_idx on public.platform_conversations (program_id, last_at desc);

alter table public.platform_messages add column if not exists conversation_id bigint
  references public.platform_conversations(id) on delete cascade;

-- 191's messages -> one "Messages" conversation per program
insert into public.platform_conversations (program_id, subject, created_by, created_at, last_at)
select m.program_id, 'Messages', (array_agg(m.sender_id order by m.created_at))[1], min(m.created_at), max(m.created_at)
  from public.platform_messages m
 where m.conversation_id is null
 group by m.program_id;
update public.platform_messages m
   set conversation_id = c.id
  from public.platform_conversations c
 where m.conversation_id is null and c.program_id = m.program_id and c.subject = 'Messages';
create index if not exists platform_messages_conv_idx on public.platform_messages (conversation_id, created_at);

-- Per person, per conversation: when last read / when removed from inbox
create table if not exists public.platform_conversation_state (
  conversation_id bigint not null references public.platform_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  read_at         timestamptz,
  hidden_at       timestamptz,
  primary key (conversation_id, user_id)
);

alter table public.platform_conversations enable row level security;
alter table public.platform_conversation_state enable row level security;
drop policy if exists "conversations_read" on public.platform_conversations;
create policy "conversations_read" on public.platform_conversations for select to authenticated
  using (public.is_platform_admin(auth.uid())
         or coalesce(public.program_role(program_id, auth.uid()) = 'head_coach', false));
drop policy if exists "conversation_state_own" on public.platform_conversation_state;
create policy "conversation_state_own" on public.platform_conversation_state for select to authenticated
  using (user_id = auth.uid());
revoke all on public.platform_conversations, public.platform_conversation_state from anon;
grant select on public.platform_conversations, public.platform_conversation_state to authenticated;


-- ── 2. Helpers ───────────────────────────────────────────────
create or replace function public._conv_can(p_conv bigint)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select exists (select 1 from public.platform_conversations c
                  where c.id = p_conv
                    and (public.is_platform_admin(auth.uid())
                         or coalesce(public.program_role(c.program_id, auth.uid()) = 'head_coach', false)))
$$;
revoke all on function public._conv_can(bigint) from public, anon;
grant execute on function public._conv_can(bigint) to authenticated;

create or replace function public._conv_add(p_conv bigint, p_body text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare v_id bigint; v_pid uuid;
begin
  select program_id into v_pid from public.platform_conversations where id = p_conv;
  insert into public.platform_messages (program_id, conversation_id, sender_id, from_platform, body)
  values (v_pid, p_conv, auth.uid(), public.is_platform_admin(auth.uid()), trim(p_body))
  returning id into v_id;
  update public.platform_conversations set last_at = now() where id = p_conv;
  insert into public.platform_conversation_state (conversation_id, user_id, read_at, hidden_at)
  values (p_conv, auth.uid(), now(), null)
  on conflict (conversation_id, user_id) do update set read_at = now(), hidden_at = null;
  return v_id;
end $$;
revoke all on function public._conv_add(bigint, text) from public, anon, authenticated;


-- ── 3. Start / reply ─────────────────────────────────────────
create or replace function public.conv_start(p_program uuid, p_subject text, p_body text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_c bigint;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not public.is_platform_admin(v_me) and coalesce(public.program_role(p_program, v_me), '') <> 'head_coach' then
    raise exception 'Only the program''s head coaches can message Winning Wall.' using errcode = '42501';
  end if;
  if coalesce(trim(p_subject), '') = '' then raise exception 'Give it a subject.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message first.'; end if;
  insert into public.platform_conversations (program_id, subject, created_by)
  values (p_program, left(trim(p_subject), 140), v_me)
  returning id into v_c;
  perform public._conv_add(v_c, p_body);
  return v_c;
end;
$function$;

create or replace function public.conv_reply(p_conv bigint, p_body text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public._conv_can(p_conv) then raise exception 'You can''t reply to that conversation.' using errcode = '42501'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message first.'; end if;
  return public._conv_add(p_conv, p_body);
end;
$function$;


-- ── 4. Inbox and messages ────────────────────────────────────
create or replace function public.conv_inbox()
 returns table(id bigint, program_id uuid, program text, org text, subject text,
               last_body text, last_at timestamptz, last_from_platform boolean, messages integer, unread integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_platform boolean := public.is_platform_admin(v_me);
  v_pid uuid := public.current_program_id();
begin
  if v_me is null then return; end if;
  if not v_platform and (v_pid is null or coalesce(public.program_role(v_pid, v_me), '') <> 'head_coach') then return; end if;
  return query
    select c.id, c.program_id, pr.name, o.name, c.subject,
           l.body, c.last_at, l.from_platform,
           (select count(*)::int from public.platform_messages m where m.conversation_id = c.id),
           (select count(*)::int from public.platform_messages m
             where m.conversation_id = c.id and m.from_platform <> v_platform
               and m.created_at > coalesce(s.read_at, '-infinity'))
      from public.platform_conversations c
      join public.programs pr on pr.id = c.program_id
      join public.organizations o on o.id = pr.organization_id
      left join public.platform_conversation_state s on s.conversation_id = c.id and s.user_id = v_me
      left join lateral (select m.body, m.from_platform from public.platform_messages m
                          where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) l on true
     where (v_platform or c.program_id = v_pid)
       and (s.hidden_at is null or c.last_at > s.hidden_at)
     order by c.last_at desc;
end;
$function$;

create or replace function public.conv_messages(p_conv bigint)
 returns table(id bigint, from_platform boolean, sender_name text, body text, created_at timestamptz, mine boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid();
begin
  if not public._conv_can(p_conv) then raise exception 'You can''t see that conversation.' using errcode = '42501'; end if;
  insert into public.platform_conversation_state (conversation_id, user_id, read_at)
  values (p_conv, v_me, now())
  on conflict (conversation_id, user_id) do update set read_at = now();
  return query
    select m.id, m.from_platform,
           case when m.from_platform then 'Winning Wall' else coalesce(p.name, 'Coach') end,
           m.body, m.created_at, m.sender_id = v_me
      from public.platform_messages m
      left join public.profiles p on p.id = m.sender_id
     where m.conversation_id = p_conv
     order by m.created_at, m.id;
end;
$function$;


-- ── 5. Delete ────────────────────────────────────────────────
create or replace function public.conv_delete(p_conv bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public._conv_can(p_conv) then raise exception 'You can''t delete that conversation.' using errcode = '42501'; end if;
  insert into public.platform_conversation_state (conversation_id, user_id, read_at, hidden_at)
  values (p_conv, auth.uid(), now(), now())
  on conflict (conversation_id, user_id) do update set hidden_at = now(), read_at = now();
end;
$function$;

create or replace function public.message_delete(p_message bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_conv bigint;
begin
  delete from public.platform_messages
   where id = p_message and sender_id = auth.uid()
  returning conversation_id into v_conv;
  if v_conv is null then raise exception 'You can only delete messages you sent.' using errcode = '42501'; end if;
  -- A conversation with nothing left in it goes away.
  if not exists (select 1 from public.platform_messages where conversation_id = v_conv) then
    delete from public.platform_conversations where id = v_conv;
  else
    update public.platform_conversations c
       set last_at = (select max(m.created_at) from public.platform_messages m where m.conversation_id = c.id)
     where c.id = v_conv;
  end if;
end;
$function$;


-- ── 6. Who to push / unread badge ────────────────────────────
create or replace function public.conv_recipients(p_conv bigint)
 returns setof uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_pid uuid;
begin
  if not public._conv_can(p_conv) then return; end if;
  select program_id into v_pid from public.platform_conversations where id = p_conv;
  if public.is_platform_admin(v_me) then
    return query select m.user_id from public.program_members m
                  where m.program_id = v_pid and m.role = 'head_coach' and m.status = 'active'
                    and not coalesce(m.is_test, false) and m.user_id <> v_me;
  else
    return query select a.user_id from public.platform_admins a where a.user_id <> v_me;
  end if;
end;
$function$;

create or replace function public.message_unread()
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select coalesce(sum(unread), 0)::int from public.conv_inbox()
$$;


-- ── 7. Retire 191's one-thread functions ─────────────────────
drop function if exists public.message_send(uuid, text);
drop function if exists public.message_thread(uuid);
drop function if exists public.message_inbox();
drop function if exists public.message_recipients(uuid);
drop table if exists public.platform_message_reads;


-- ── 8. Who can call these ────────────────────────────────────
revoke all on function public.conv_inbox() from public, anon;
revoke all on function public.conv_messages(bigint) from public, anon;
revoke all on function public.conv_start(uuid, text, text) from public, anon;
revoke all on function public.conv_reply(bigint, text) from public, anon;
revoke all on function public.conv_delete(bigint) from public, anon;
revoke all on function public.message_delete(bigint) from public, anon;
revoke all on function public.conv_recipients(bigint) from public, anon;
revoke all on function public.message_unread() from public, anon;
grant execute on function public.conv_inbox() to authenticated;
grant execute on function public.conv_messages(bigint) to authenticated;
grant execute on function public.conv_start(uuid, text, text) to authenticated;
grant execute on function public.conv_reply(bigint, text) to authenticated;
grant execute on function public.conv_delete(bigint) to authenticated;
grant execute on function public.message_delete(bigint) to authenticated;
grant execute on function public.conv_recipients(bigint) to authenticated;
grant execute on function public.message_unread() to authenticated;

commit;


-- ── Check ─────────────────────────────────────────────────────
select 'conversations' as item, count(*)::text as value from public.platform_conversations
union all select 'messages in a conversation', count(*)::text from public.platform_messages where conversation_id is not null
union all select 'messages NOT in a conversation (should be 0)', count(*)::text from public.platform_messages where conversation_id is null;
