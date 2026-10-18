-- ============================================================
-- 189_platform_admin.sql
--
-- PLATFORM ADMIN PAGE (drop 1): what the page reads and does. Everything
-- here is platform-admin only (checked inside each function).
--
--   * platform_programs()          schools -> programs, with players,
--                                  coaches, waiting approval, head
--                                  coaches, team code, colors, features off
--   * platform_search_people(q)    find a signed-up person by name/email
--   * platform_set_head_coach(...) make / stop being head coach of a
--                                  program (stopping keeps them as an
--                                  assistant coach there)
--   * platform_new_join_code(p)    replace a program's team code
--   * platform_create_program(...) new program under a school, set up
--                                  with: a current season, settings and
--                                  XP settings copied from AHS Boys
--                                  (scoring starts now), Boys' badge list
--   * Paused programs (programs.is_active = false): nobody can work in
--     them except the platform admin, and the team code stops working
--     (that part already worked). Nothing is deleted.
--
-- Schools, colors, logos and feature switches are saved straight to
-- their tables (the platform admin already has write access to those).
--
-- Feature keys used by the app: offseason, lifting, inseason, playbook,
-- quizzes. No row = on (as set up in 174).
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Paused programs: only the platform admin gets in ──────
create or replace function public.current_program_id()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.active_program_id
  from public.profiles p
  join public.programs pr on pr.id = p.active_program_id
  where p.id = auth.uid()
    and public.is_program_member(p.active_program_id, auth.uid())
    and (coalesce(pr.is_active, true) or public.is_platform_admin(auth.uid()));
$function$;


-- ── 2. The overview ──────────────────────────────────────────
create or replace function public.platform_programs()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'short_name', o.short_name,
      'primary_color', o.primary_color, 'secondary_color', o.secondary_color,
      'accent_color', o.accent_color, 'logo_url', o.logo_url, 'timezone', o.timezone,
      'programs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pr.id, 'name', pr.name, 'is_active', coalesce(pr.is_active, true),
          'join_code', pr.join_code,
          'primary_color', pr.primary_color, 'secondary_color', pr.secondary_color,
          'accent_color', pr.accent_color, 'logo_url', pr.logo_url,
          'players', (select count(*) from public.program_members m
                       where m.program_id = pr.id and m.role = 'player' and m.status = 'active' and not coalesce(m.is_test, false)),
          'coaches', (select count(*) from public.program_members m
                       where m.program_id = pr.id and m.role in ('head_coach', 'coach') and m.status = 'active' and not coalesce(m.is_test, false)),
          'pending', (select count(*) from public.program_members m
                       where m.program_id = pr.id and m.status = 'pending'),
          'head_coaches', coalesce((
            select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', e.email) order by p.name)
              from public.program_members m
              join public.profiles p on p.id = m.user_id
              left join public.profile_emails e on e.id = p.id
             where m.program_id = pr.id and m.role = 'head_coach' and m.status = 'active'
               and not coalesce(m.is_test, false)), '[]'::jsonb),
          'features_off', coalesce((
            select jsonb_agg(f.feature_key order by f.feature_key)
              from public.program_features f
             where f.program_id = pr.id and not f.enabled), '[]'::jsonb)
        ) order by pr.name)
          from public.programs pr where pr.organization_id = o.id), '[]'::jsonb)
    ) order by o.name)
    from public.organizations o), '[]'::jsonb);
end;
$function$;


-- ── 3. Find a person ─────────────────────────────────────────
create or replace function public.platform_search_people(p_query text)
 returns table(id uuid, name text, email text, profile_role text, programs text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare q text := '%' || lower(trim(coalesce(p_query, ''))) || '%';
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_query, ''))) < 2 then return; end if;
  return query
    select p.id, p.name, e.email, p.role,
           (select string_agg(pr.name || ' (' || replace(m.role, '_', ' ') ||
                              case when m.status <> 'active' then ', ' || m.status else '' end || ')', ', ' order by pr.name)
              from public.program_members m join public.programs pr on pr.id = m.program_id
             where m.user_id = p.id)
      from public.profiles p
      left join public.profile_emails e on e.id = p.id
     where (lower(p.name) like q or lower(coalesce(e.email, '')) like q)
       and p.role not in ('test_player')
     order by p.name
     limit 20;
end;
$function$;


-- ── 4. Head coaches ──────────────────────────────────────────
create or replace function public.platform_set_head_coach(p_program uuid, p_user uuid, p_head boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.programs where id = p_program) then
    raise exception 'That program doesn''t exist.';
  end if;

  if p_head then
    -- Someone still waiting for approval becomes a coach first.
    update public.profiles set role = 'coach'
     where id = p_user and role in ('pending_coach', 'pending_player');
    insert into public.program_members (program_id, user_id, role, status)
    values (p_program, p_user, 'head_coach', 'active')
    on conflict (program_id, user_id) do update set role = 'head_coach', status = 'active';
    update public.profiles set active_program_id = p_program
     where id = p_user and active_program_id is null;
  else
    -- Stays in the program as an assistant coach.
    update public.program_members set role = 'coach'
     where program_id = p_program and user_id = p_user and role = 'head_coach';
  end if;
end;
$function$;


-- ── 5. New team code ─────────────────────────────────────────
create or replace function public.platform_new_join_code(p_program uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v text;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  v := public.new_join_code();
  update public.programs set join_code = v where id = p_program;
  return v;
end;
$function$;


-- ── 6. New program, ready to use ─────────────────────────────
create or replace function public.platform_create_program(p_org uuid, p_name text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tpl uuid := public.legacy_default_program_id();   -- settings template: AHS Boys
  v_id  uuid;
  o     public.organizations%rowtype;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the program a name.'; end if;
  select * into o from public.organizations where id = p_org;
  if not found then raise exception 'That school doesn''t exist.'; end if;
  if exists (select 1 from public.programs where organization_id = p_org and lower(name) = lower(trim(p_name))) then
    raise exception '% already has a program called %.', o.name, trim(p_name);
  end if;

  insert into public.programs (organization_id, name, primary_color, secondary_color, accent_color, is_active)
  values (p_org, trim(p_name), o.primary_color, o.secondary_color, o.accent_color, true)
  returning id into v_id;

  -- Current season, named like the template's
  insert into public.seasons (program_id, name, is_current, start_date)
  select v_id, s.name, true, s.start_date from public.seasons s
   where s.program_id = v_tpl and s.is_current
   limit 1;

  -- Settings and XP settings (scoring starts now), badge list
  insert into public.app_settings (program_id, key, value, updated_at)
  select v_id, s.key, case when s.key = 'scoring_started_at' then now()::text else s.value end, now()
    from public.app_settings s where s.program_id = v_tpl
  on conflict (program_id, key) do nothing;
  insert into public.app_settings (program_id, key, value, updated_at)
  values (v_id, 'scoring_started_at', now()::text, now())
  on conflict (program_id, key) do nothing;
  insert into public.xp_settings (program_id, perk_key, perk_name, xp_required, description, updated_at)
  select v_id, x.perk_key, x.perk_name, x.xp_required, x.description, now()
    from public.xp_settings x where x.program_id = v_tpl
  on conflict (program_id, perk_key) do nothing;
  insert into public.badges (program_id, icon, name, description, trigger_type, trigger_value, is_active, created_at)
  select v_id, b.icon, b.name, b.description, b.trigger_type, b.trigger_value, b.is_active, now()
    from public.badges b where b.program_id = v_tpl;

  return v_id;
end;
$function$;


-- ── 7. Who can call these ────────────────────────────────────
revoke all on function public.platform_programs() from public, anon;
revoke all on function public.platform_search_people(text) from public, anon;
revoke all on function public.platform_set_head_coach(uuid, uuid, boolean) from public, anon;
revoke all on function public.platform_new_join_code(uuid) from public, anon;
revoke all on function public.platform_create_program(uuid, text) from public, anon;
grant execute on function public.platform_programs() to authenticated;
grant execute on function public.platform_search_people(text) to authenticated;
grant execute on function public.platform_set_head_coach(uuid, uuid, boolean) to authenticated;
grant execute on function public.platform_new_join_code(uuid) to authenticated;
grant execute on function public.platform_create_program(uuid, text) to authenticated;

commit;


-- ── Check ─────────────────────────────────────────────────────
-- One row per program, as the Platform page will show it.
select o.name as school, pr.name as program, coalesce(pr.is_active, true) as active, pr.join_code,
       (select string_agg(p.name, ', ' order by p.name) from public.program_members m join public.profiles p on p.id = m.user_id
         where m.program_id = pr.id and m.role = 'head_coach' and m.status = 'active' and not coalesce(m.is_test, false)) as head_coaches,
       (select count(*) from public.program_members m where m.program_id = pr.id and m.role = 'player'
          and m.status = 'active' and not coalesce(m.is_test, false)) as players
  from public.programs pr join public.organizations o on o.id = pr.organization_id
 order by 1, 2;
