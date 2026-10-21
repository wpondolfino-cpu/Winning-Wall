-- ============================================================
-- 203_staff_messages.sql
--
-- STAFF MESSAGES: an inbox between a program's coaches (head coaches and
-- assistants), in the same style as messages with Winning Wall.
--
--   * Anyone on the staff can start a conversation, with chosen coaches
--     or with the whole staff, and anyone in it can reply.
--   * A whole-staff conversation includes whoever is on the staff now,
--     so a coach added later sees it too.
--   * Delete a conversation = it leaves YOUR inbox only; a new reply
--     brings it back. Delete a message = only one you sent, for everyone.
--   * Players never see any of it. Neither does another program.
--
-- Functions (all check who's asking; everything is in the program you're in):
--   staff_people()                   coaches you can message
--   staff_start(subject, body, to[]) new conversation (to = null: whole staff)
--   staff_reply(c, body)             reply
--   staff_inbox()                    my conversations
--   staff_thread(c)                  a conversation's messages; marks it read
--   staff_hide(c)                    remove from my inbox
--   staff_message_delete(id)         delete a message I sent
--   staff_recipients(c)              who to push a new message to
--   staff_unread()                   unread count for the badge
--
-- New tables only; nothing existing changes. One transaction.
-- ============================================================

begin;
set local client_min_messages = warning;

-- ── 1. Tables ────────────────────────────────────────────────
create table if not exists public.staff_conversations (
  id          bigint generated always as identity primary key,
  program_id  uuid not null references public.programs(id) on delete cascade,
  subject     text not null check (length(trim(subject)) > 0 and length(subject) <= 140),
  everyone    boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  last_at     timestamptz not null default now()
);
create index if not exists staff_conversations_program_idx on public.staff_conversations (program_id, last_at desc);

-- Who's in a conversation (for everyone = true: just read/hidden state).
create table if not exists public.staff_conversation_members (
  conversation_id bigint not null references public.staff_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  read_at         timestamptz,
  hidden_at       timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists staff_conversation_members_user_idx on public.staff_conversation_members (user_id);

create table if not exists public.staff_messages (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references public.staff_conversations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  sender_id       uuid references public.profiles(id) on delete set null,
  body            text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at      timestamptz not null default now()
);
create index if not exists staff_messages_conv_idx on public.staff_messages (conversation_id, created_at);

-- Everything goes through the functions below; no direct reads or writes.
alter table public.staff_conversations enable row level security;
alter table public.staff_conversation_members enable row level security;
alter table public.staff_messages enable row level security;
revoke all on public.staff_conversations, public.staff_conversation_members, public.staff_messages from anon, authenticated;


-- ── 2. Helpers ───────────────────────────────────────────────
create or replace function public._is_staff(p_program uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.program_role(p_program, p_user) in ('head_coach', 'coach'), false)
$$;

create or replace function public._staff_can(p_conv bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_conversations c
     where c.id = p_conv
       and public._is_staff(c.program_id, auth.uid())
       and (c.everyone or exists (select 1 from public.staff_conversation_members m
                                   where m.conversation_id = c.id and m.user_id = auth.uid())))
$$;

create or replace function public._staff_add(p_conv bigint, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_pid uuid;
begin
  select program_id into v_pid from public.staff_conversations where id = p_conv;
  insert into public.staff_messages (conversation_id, program_id, sender_id, body)
  values (p_conv, v_pid, auth.uid(), trim(p_body))
  returning id into v_id;
  update public.staff_conversations set last_at = now() where id = p_conv;
  insert into public.staff_conversation_members (conversation_id, user_id, read_at, hidden_at)
  values (p_conv, auth.uid(), now(), null)
  on conflict (conversation_id, user_id) do update set read_at = now(), hidden_at = null;
  return v_id;
end $$;


-- ── 3. People / start / reply ────────────────────────────────
create or replace function public.staff_people()
returns table(id uuid, name text, role text)
language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public.current_program_id();
begin
  if v_pid is null or not public._is_staff(v_pid, auth.uid()) then return; end if;
  return query
    select p.id, p.name, m.role
      from public.program_members m
      join public.profiles p on p.id = m.user_id
     where m.program_id = v_pid and m.status = 'active' and m.role in ('head_coach', 'coach')
       and not coalesce(m.is_test, false) and m.user_id <> auth.uid()
     order by (m.role = 'head_coach') desc, p.name;
end $$;

create or replace function public.staff_start(p_subject text, p_body text, p_to uuid[])
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_pid uuid := public.current_program_id();
  v_c   bigint;
  v_all boolean := p_to is null or cardinality(p_to) = 0;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if v_pid is null or not public._is_staff(v_pid, v_me) then
    raise exception 'Only coaches can send staff messages.' using errcode = '42501';
  end if;
  if coalesce(trim(p_subject), '') = '' then raise exception 'Give it a subject.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message first.'; end if;
  if not v_all and exists (select 1 from unnest(p_to) t(u) where not public._is_staff(v_pid, t.u)) then
    raise exception 'Everyone you message has to be a coach in this program.';
  end if;

  insert into public.staff_conversations (program_id, subject, everyone, created_by)
  values (v_pid, left(trim(p_subject), 140), v_all, v_me)
  returning id into v_c;
  if not v_all then
    insert into public.staff_conversation_members (conversation_id, user_id)
    select v_c, u from unnest(p_to) t(u) where u <> v_me
    on conflict do nothing;
  end if;
  perform public._staff_add(v_c, p_body);
  return v_c;
end $$;

create or replace function public.staff_reply(p_conv bigint, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not public._staff_can(p_conv) then raise exception 'You can''t reply to that conversation.' using errcode = '42501'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message first.'; end if;
  return public._staff_add(p_conv, p_body);
end $$;


-- ── 4. Inbox and thread ──────────────────────────────────────
create or replace function public.staff_inbox()
returns table(id bigint, subject text, everyone boolean, people text,
              last_body text, last_sender text, last_mine boolean, last_at timestamptz, messages integer, unread integer)
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_pid uuid := public.current_program_id();
begin
  if v_me is null or v_pid is null or not public._is_staff(v_pid, v_me) then return; end if;
  return query
    select c.id, c.subject, c.everyone,
           case when c.everyone then 'Whole staff'
                else coalesce((select string_agg(p.name, ', ' order by p.name)
                                 from public.staff_conversation_members m join public.profiles p on p.id = m.user_id
                                where m.conversation_id = c.id and m.user_id <> v_me), 'Just you') end,
           l.body, l.sender, l.sender_id = v_me, c.last_at,
           (select count(*)::int from public.staff_messages x where x.conversation_id = c.id),
           (select count(*)::int from public.staff_messages x
             where x.conversation_id = c.id and x.sender_id is distinct from v_me
               and x.created_at > coalesce(s.read_at, '-infinity'))
      from public.staff_conversations c
      left join public.staff_conversation_members s on s.conversation_id = c.id and s.user_id = v_me
      left join lateral (select x.body, x.sender_id, coalesce(p.name, 'Coach') as sender
                           from public.staff_messages x left join public.profiles p on p.id = x.sender_id
                          where x.conversation_id = c.id order by x.created_at desc, x.id desc limit 1) l on true
     where c.program_id = v_pid
       and (c.everyone or s.user_id is not null)
       and (s.hidden_at is null or c.last_at > s.hidden_at)
     order by c.last_at desc;
end $$;

create or replace function public.staff_thread(p_conv bigint)
returns table(id bigint, sender_name text, body text, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if not public._staff_can(p_conv) then raise exception 'You can''t see that conversation.' using errcode = '42501'; end if;
  insert into public.staff_conversation_members (conversation_id, user_id, read_at)
  values (p_conv, v_me, now())
  on conflict (conversation_id, user_id) do update set read_at = now();
  return query
    select x.id, coalesce(p.name, 'Coach'), x.body, x.created_at, x.sender_id = v_me
      from public.staff_messages x
      left join public.profiles p on p.id = x.sender_id
     where x.conversation_id = p_conv
     order by x.created_at, x.id;
end $$;


-- ── 5. Delete ────────────────────────────────────────────────
create or replace function public.staff_hide(p_conv bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._staff_can(p_conv) then raise exception 'You can''t delete that conversation.' using errcode = '42501'; end if;
  insert into public.staff_conversation_members (conversation_id, user_id, read_at, hidden_at)
  values (p_conv, auth.uid(), now(), now())
  on conflict (conversation_id, user_id) do update set hidden_at = now(), read_at = now();
end $$;

create or replace function public.staff_message_delete(p_message bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_conv bigint;
begin
  delete from public.staff_messages where id = p_message and sender_id = auth.uid()
  returning conversation_id into v_conv;
  if v_conv is null then raise exception 'You can only delete messages you sent.' using errcode = '42501'; end if;
  if not exists (select 1 from public.staff_messages where conversation_id = v_conv) then
    delete from public.staff_conversations where id = v_conv;
  else
    update public.staff_conversations c
       set last_at = (select max(x.created_at) from public.staff_messages x where x.conversation_id = c.id)
     where c.id = v_conv;
  end if;
end $$;


-- ── 6. Push / badge ──────────────────────────────────────────
create or replace function public.staff_recipients(p_conv bigint)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  if not public._staff_can(p_conv) then return; end if;
  select * into c from public.staff_conversations where id = p_conv;
  if c.everyone then
    return query select m.user_id from public.program_members m
                  where m.program_id = c.program_id and m.status = 'active' and m.role in ('head_coach', 'coach')
                    and not coalesce(m.is_test, false) and m.user_id <> auth.uid();
  else
    return query select s.user_id from public.staff_conversation_members s
                  where s.conversation_id = p_conv and s.user_id <> auth.uid()
                    and public._is_staff(c.program_id, s.user_id);
  end if;
end $$;

create or replace function public.staff_unread()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(unread), 0)::int from public.staff_inbox()
$$;


-- ── 7. Who can call these ────────────────────────────────────
revoke all on function public._is_staff(uuid, uuid), public._staff_can(bigint), public._staff_add(bigint, text)
  from public, anon, authenticated;
revoke all on function public.staff_people(), public.staff_start(text, text, uuid[]), public.staff_reply(bigint, text),
  public.staff_inbox(), public.staff_thread(bigint), public.staff_hide(bigint), public.staff_message_delete(bigint),
  public.staff_recipients(bigint), public.staff_unread() from public, anon;
grant execute on function public.staff_people(), public.staff_start(text, text, uuid[]), public.staff_reply(bigint, text),
  public.staff_inbox(), public.staff_thread(bigint), public.staff_hide(bigint), public.staff_message_delete(bigint),
  public.staff_recipients(bigint), public.staff_unread() to authenticated;

commit;

select 'yes' as staff_messages_ready;
