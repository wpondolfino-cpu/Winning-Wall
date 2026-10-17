-- ============================================================
-- 186_scope_announcements.sql
--
-- MULTI-TENANCY STEP 9 — announcements and notifications.
--
-- Fenced to their program (restrictive "program_scope", as before):
--   announcements, announcement hides ("I've read this"), and the
--   notifications log. Before this, a Girls player would have seen
--   Boys' announcements.
--
-- Also:
--   * Post to every program (platform admin only): one announcement is
--     copied into each program, linked by a shared broadcast id so it
--     can be removed from every program at once. Each program's copy
--     can be pinned/unpinned there like any other announcement.
--   * Ships with:
--       - AnnouncementPanel.tsx ("Post to every program" checkbox and
--         "Remove everywhere" for you)
--       - send-push: "notify every player" now reaches only the program
--         you're in; a new "every program" audience for platform admins.
--
-- Boys' announcements are not changed.
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Broadcasts: one id shared by every program's copy ─────
alter table public.announcements add column if not exists broadcast_id uuid;
create index if not exists announcements_broadcast_idx
  on public.announcements (broadcast_id) where broadcast_id is not null;


-- ── 2. The program fence ──────────────────────────────────────
select public.add_program_scope(t) from unnest(array[
  'announcements',
  'announcement_hides',
  'notifications'
]) as t;


-- ── 3. Post to / remove from every program (platform admin) ──
create or replace function public.post_announcement_everywhere(p_message text, p_pinned boolean default false)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_id uuid := gen_random_uuid();
  n int;
begin
  if not public.is_platform_admin(v_me) then
    raise exception 'Only the platform admin can post to every program.' using errcode = '42501';
  end if;
  if coalesce(trim(p_message), '') = '' then
    raise exception 'Write a message first.';
  end if;
  select name into v_name from public.profiles where id = v_me;
  insert into public.announcements (program_id, coach_id, coach_name, message, is_pinned, broadcast_id, created_at)
  select p.id, v_me, v_name, trim(p_message), coalesce(p_pinned, false), v_id, now()
    from public.programs p
   where coalesce(p.is_active, true);
  get diagnostics n = row_count;
  return n;
end;
$function$;

create or replace function public.delete_announcement_everywhere(p_broadcast_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Only the platform admin can do that.' using errcode = '42501';
  end if;
  delete from public.announcement_hides h
   using public.announcements a
   where h.announcement_id = a.id and a.broadcast_id = p_broadcast_id;
  delete from public.announcements where broadcast_id = p_broadcast_id;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.post_announcement_everywhere(text, boolean) from public, anon;
revoke all on function public.delete_announcement_everywhere(uuid) from public, anon;
grant execute on function public.post_announcement_everywhere(text, boolean) to authenticated;
grant execute on function public.delete_announcement_everywhere(uuid) to authenticated;

commit;


-- ── Check ─────────────────────────────────────────────────────
-- One row per program. Boys: the announcements you have today.
-- Girls: 0. fenced = 3 on both.
select pr.name as program,
       (select count(*) from public.announcements a where a.program_id = pr.id) as announcements,
       (select count(*) from public.announcement_hides h where h.program_id = pr.id) as hides,
       (select count(*) from public.notifications n where n.program_id = pr.id) as notifications,
       (select count(*) from pg_policy pol where pol.polname = 'program_scope'
          and pol.polrelid::regclass::text in ('announcements','announcement_hides','notifications')) as fenced
  from public.programs pr
 order by pr.name;
