-- ============================================================
-- 177_scope_plays.sql
--
-- MULTI-TENANCY STEP 3 — the first real split: plays & playbooks.
--
-- After this, each program only sees its own:
--   plays, play shares, playbooks, playbook plays, playbook shares,
--   saved actions, templates (formations), play categories.
--
-- How: ONE "program_scope" policy per table, RESTRICTIVE, meaning it is
-- AND-ed with every rule the table already has. Nothing existing is
-- rewritten — the old rules still decide WHO can do WHAT; this one
-- adds "…and only inside your current program". Same pattern for every
-- later group, so a single query can prove coverage.
--
-- Also:
--   * Play categories are keyed per program (Girls can have its own
--     "Offense" without clashing with Boys').
--   * Approving a signup now also adds the person to a program — the
--     approving coach's current program. Without this, a newly approved
--     player would have no program and see nothing in the split
--     sections. (Temporary until join codes replace approval.)
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Play categories: one list per program ──────────────────
-- plays.category points at a category by name; it now points at
-- (program, name). Renames still cascade to the program's plays.

alter table public.plays drop constraint if exists plays_category_fkey;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'plays_categories_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (name)') then
    alter table public.plays_categories drop constraint plays_categories_pkey;
    alter table public.plays_categories add constraint plays_categories_pkey primary key (program_id, name);
  end if;
end $$;

alter table public.plays
  add constraint plays_category_fkey foreign key (program_id, category)
  references public.plays_categories (program_id, name)
  on update cascade on delete restrict;


-- ── 2. The program fence ──────────────────────────────────────

create or replace function public.add_program_scope(tbl text)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists "program_scope" on public.%I', tbl);
  execute format($p$
    create policy "program_scope" on public.%I
      as restrictive
      for all
      using (program_id = public.current_program_id())
      with check (program_id = public.current_program_id())
  $p$, tbl);
end $$;
revoke all on function public.add_program_scope(text) from public, anon, authenticated;

select public.add_program_scope(t) from unnest(array[
  'plays', 'play_shares', 'playbooks', 'playbook_plays', 'playbook_shares',
  'saved_actions', 'formations', 'plays_categories'
]) as t;


-- ── 3. Approval adds program membership ───────────────────────
-- Fires when profiles.role changes (approve a signup, mark a player
-- inactive, promote a coach). Writes the matching membership in the
-- program the person MAKING the change is working in.
--   admin -> head_coach · coach -> coach · player -> player
--   inactive -> player, status inactive · pending_* -> nothing yet

create or replace function public.sync_membership_from_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_pid uuid := public.current_program_id();
  pid       uuid;
  m_role    text;
  m_stat    text;
begin
  if new.role in ('pending_player', 'pending_coach') then return new; end if;
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then return new; end if;
  if public.is_platform_admin(new.id) then return new; end if;

  -- Already in the program the change is made from -> update that one.
  -- Already in some other program -> update their own, never add a
  -- stray membership. In none yet (a fresh approval) -> join the
  -- approver's program.
  if actor_pid is not null and exists (select 1 from public.program_members
                                        where program_id = actor_pid and user_id = new.id) then
    pid := actor_pid;
  elsif exists (select 1 from public.program_members where user_id = new.id) then
    pid := coalesce(
      (select program_id from public.program_members where user_id = new.id and program_id = new.active_program_id),
      (select program_id from public.program_members where user_id = new.id order by created_at limit 1));
  else
    pid := coalesce(actor_pid, new.active_program_id, public.legacy_default_program_id());
  end if;

  m_role := case new.role when 'admin' then 'head_coach' when 'coach' then 'coach' else 'player' end;
  m_stat := case new.role when 'inactive' then 'inactive' else 'active' end;

  insert into public.program_members (program_id, user_id, role, status)
  values (pid, new.id, m_role, m_stat)
  on conflict (program_id, user_id) do update
    set role = excluded.role, status = excluded.status;

  if new.active_program_id is null then
    update public.profiles set active_program_id = pid where id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.sync_membership_from_role() from public, anon, authenticated;

drop trigger if exists sync_membership_from_role on public.profiles;
create trigger sync_membership_from_role
  after insert or update of role on public.profiles
  for each row execute function public.sync_membership_from_role();

commit;


-- ── 4. Summary ────────────────────────────────────────────────
select 'tables fenced to their program' as item,
       string_agg(tablename, ', ' order by tablename) as value
from pg_policies where policyname = 'program_scope' and permissive = 'RESTRICTIVE'
union all
select 'play categories key',
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'plays_categories_pkey')
union all
select 'Boys plays / playbooks / categories',
       (select count(*) from public.plays p join public.programs pr on pr.id = p.program_id where pr.name = 'Boys Basketball')::text
       || ' / ' ||
       (select count(*) from public.playbooks p join public.programs pr on pr.id = p.program_id where pr.name = 'Boys Basketball')::text
       || ' / ' ||
       (select count(*) from public.plays_categories p join public.programs pr on pr.id = p.program_id where pr.name = 'Boys Basketball')::text
union all
select 'approval trigger',
       (select count(*)::text from pg_trigger where tgname = 'sync_membership_from_role');
