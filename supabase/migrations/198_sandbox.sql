-- 198_sandbox.sql
-- A private sandbox program for the platform admin.
--
-- What this adds:
--   * A hidden "Sandbox" school and program (organization kind 'sandbox').
--     No team code, so nobody can join it. Only the platform admin can go in.
--   * It's left out of everything platform-wide: school/program lists, home
--     counts and "needs attention", player totals, people search, the
--     Shared Library program count and "post to every program".
--   * sandbox_overview(): the sandbox's people and rosters, for its page.
--   * sandbox_reset(): wipes everything made in the sandbox (practices,
--     games, plays, quizzes, scores, XP, attendance...) and puts the
--     Shared Library starter pack back. People, rosters, seasons and
--     settings stay. Only ever touches the sandbox program.
--   * in_sandbox(): true while you're in it (for the gold bar).
-- The 36 players and 3 coaches are created by the view-as function
-- (logins can only be made there), the first time you open the page.
-- Changes nothing in any real program. Safe to run again.

begin;

-- ── 1. The sandbox school and program ───────────────────────────
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.organizations'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.organizations drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.organizations add constraint organizations_kind_check
  check (kind in ('school', 'trainer', 'library', 'sandbox'));

do $$
declare
  v_org  uuid;
  v_prog uuid;
  v_tpl  uuid := public.legacy_default_program_id();   -- settings template: AHS Boys
begin
  select id into v_org from public.organizations where kind = 'sandbox' order by created_at limit 1;
  if v_org is null then
    insert into public.organizations (name, short_name, kind, primary_color, secondary_color, accent_color, timezone)
    values ('Sandbox', 'SB', 'sandbox', '#3a3f4b', '#b0b8c8', '#f0c040', 'America/New_York')
    returning id into v_org;
  end if;

  select id into v_prog from public.programs where organization_id = v_org order by created_at limit 1;
  if v_prog is null then
    insert into public.programs (organization_id, name, primary_color, secondary_color, accent_color, is_active, join_code)
    values (v_org, 'Sandbox', '#3a3f4b', '#b0b8c8', '#f0c040', true, null)
    returning id into v_prog;

    -- The same starting settings a new program gets.
    insert into public.seasons (program_id, name, is_current, start_date)
    select v_prog, s.name, true, s.start_date from public.seasons s
     where s.program_id = v_tpl and s.is_current
     limit 1;
    insert into public.app_settings (program_id, key, value, updated_at)
    select v_prog, s.key, case when s.key = 'scoring_started_at' then now()::text else s.value end, now()
      from public.app_settings s where s.program_id = v_tpl
    on conflict (program_id, key) do nothing;
    insert into public.app_settings (program_id, key, value, updated_at)
    values (v_prog, 'scoring_started_at', now()::text, now())
    on conflict (program_id, key) do nothing;
    insert into public.xp_settings (program_id, perk_key, perk_name, xp_required, description, updated_at)
    select v_prog, x.perk_key, x.perk_name, x.xp_required, x.description, now()
      from public.xp_settings x where x.program_id = v_tpl
    on conflict (program_id, perk_key) do nothing;
    insert into public.badges (program_id, icon, name, description, trigger_type, trigger_value, is_active, created_at)
    select v_prog, b.icon, b.name, b.description, b.trigger_type, b.trigger_value, b.is_active, now()
      from public.badges b where b.program_id = v_tpl;
  end if;
end $$;

-- ── 2. Helpers ──────────────────────────────────────────────────
create or replace function public.sandbox_program_id()
returns uuid language sql stable security definer set search_path = public as $$
  select pr.id from public.programs pr
    join public.organizations o on o.id = pr.organization_id
   where o.kind = 'sandbox'
   order by pr.created_at
   limit 1
$$;

create or replace function public.is_sandbox_program(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pid is not null and pid = public.sandbox_program_id()
$$;

-- True while the signed-in account is working in the sandbox.
create or replace function public.in_sandbox()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_sandbox_program(public.current_program_id())
$$;

-- ── 3. The sandbox page ─────────────────────────────────────────
create or replace function public.sandbox_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public.sandbox_program_id();
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'program_id', v_pid,
    'rosters', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color) order by r.sort_order, r.name)
        from public.rosters r where r.program_id = v_pid and r.status = 'active'), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.id, 'name', p.name, 'role', m.role,
               'graduation_year', p.graduation_year,
               'roster_id', p.home_roster_id, 'roster', r.name)
             order by case m.role when 'head_coach' then 0 when 'coach' then 1 else 2 end, r.sort_order nulls last, p.name)
        from public.program_members m
        join public.profiles p on p.id = m.user_id
        left join public.rosters r on r.id = p.home_roster_id
       where m.program_id = v_pid and m.status = 'active'
         and not public.is_platform_admin(m.user_id)), '[]'::jsonb),
    'content', jsonb_build_object(
      'practices', (select count(*) from public.practices x where x.program_id = v_pid and not coalesce(x.is_template, false)),
      'games',     (select count(*) from public.games x where x.program_id = v_pid),
      'plays',     (select count(*) from public.plays x where x.program_id = v_pid),
      'quizzes',   (select count(*) from public.quizzes x where x.program_id = v_pid),
      'scores',    (select count(*) from public.scores x where x.program_id = v_pid))
  );
end $$;

-- ── 4. Reset ────────────────────────────────────────────────────
-- Kept: the people and their memberships, rosters, seasons, settings
-- (app, XP perks, badges, features), category and tag names, and
-- anything platform-level (messages, the change log).
create or replace function public._sandbox_has_rows(p_table text, p_pid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r boolean;
begin
  execute format('select exists (select 1 from public.%I where program_id = $1)', p_table) into r using p_pid;
  return r;
end $$;

create or replace function public.sandbox_reset()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pid   uuid := public.sandbox_program_id();
  v_keep  text[] := array[
    'program_members', 'program_features', 'rosters', 'seasons', 'app_settings', 'xp_settings', 'badges',
    'drill_categories', 'practice_drill_categories', 'practice_drill_tags', 'plays_categories',
    'team_positions', 'report_layout', 'platform_conversations', 'platform_messages', 'platform_log'];
  v_all   text[];
  v_left  text[];
  v_next  text[];
  v_round int;
  v_pass  int;
  v_rows  bigint;
  v_total bigint := 0;
  v_owner uuid;
  v_added int;
  t       text;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  if v_pid is null then raise exception 'There''s no sandbox program.'; end if;
  -- Belt and braces: never run against anything but the sandbox.
  if not exists (select 1 from public.programs pr join public.organizations o on o.id = pr.organization_id
                  where pr.id = v_pid and o.kind = 'sandbox' and pr.join_code is null) then
    raise exception 'Refusing to reset: that program isn''t the sandbox.';
  end if;

  select coalesce(array_agg(c.table_name::text order by c.table_name), '{}') into v_all
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'program_id' and tb.table_type = 'BASE TABLE'
     and c.table_name <> all (v_keep);

  -- Tables point at each other, so keep going round until everything is
  -- gone (a delete blocked by another row just waits a round), then check
  -- again in case a delete trigger wrote something back.
  for v_round in 1..4 loop
    v_left := v_all;
    for v_pass in 1..30 loop
      v_next := '{}';
      foreach t in array v_left loop
        begin
          execute format('delete from public.%I where program_id = $1', t) using v_pid;
          get diagnostics v_rows = row_count;
          v_total := v_total + v_rows;
        exception when foreign_key_violation then
          v_next := v_next || t;
        end;
      end loop;
      exit when cardinality(v_next) = 0;
      if cardinality(v_next) = cardinality(v_left) then
        raise exception 'Couldn''t clear these sandbox tables: %', array_to_string(v_next, ', ');
      end if;
      v_left := v_next;
    end loop;
    exit when not exists (select 1 from unnest(v_all) x(tn) where public._sandbox_has_rows(x.tn, v_pid));
  end loop;

  -- What the library uses to avoid copying twice: the copies are gone now.
  delete from public.library_copies where target_program = v_pid;

  -- Player totals kept on the profile itself.
  update public.profiles p
     set total_xp = 0, team_wins = 0, is_period_champion = false, champion_since = null, team_id = null
   where exists (select 1 from public.program_members m where m.program_id = v_pid and m.user_id = p.id)
     and not public.is_platform_admin(p.id)
     and not exists (select 1 from public.program_members o where o.user_id = p.id and o.program_id <> v_pid);

  -- Put the starter pack back, owned by the sandbox head coach.
  select m.user_id into v_owner from public.program_members m
   where m.program_id = v_pid and m.role = 'head_coach' and m.status = 'active'
   order by m.created_at limit 1;
  v_added := public._lib_apply_starter(v_pid, coalesce(v_owner, auth.uid()));

  perform public._plog('Sandbox reset', null, v_pid, v_total || ' rows cleared');
  return jsonb_build_object('cleared', v_total, 'starter_items', v_added);
end $$;

-- ── 5. Platform-wide pages leave the sandbox out ────────────────
CREATE OR REPLACE FUNCTION public.platform_programs()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'short_name', o.short_name, 'kind', o.kind,
      'primary_color', o.primary_color, 'secondary_color', o.secondary_color,
      'accent_color', o.accent_color, 'logo_url', o.logo_url, 'timezone', o.timezone,
      'notes', n.notes, 'plan', n.plan,
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
          'last_active', (select max(p.last_seen_at) from public.program_members m join public.profiles p on p.id = m.user_id
                           where m.program_id = pr.id and m.status = 'active' and not coalesce(m.is_test, false)
                             and not public.is_platform_admin(m.user_id)),
          'head_coaches', coalesce((
            select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', e.email, 'last_seen', p.last_seen_at) order by p.name)
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
    from public.organizations o
    left join public.platform_org_notes n on n.org_id = o.id
   where o.kind not in ('library', 'sandbox')), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'schools',  (select count(*) from public.organizations where kind = 'school'),
    'trainers', (select count(*) from public.organizations where kind = 'trainer'),
    'programs', (select count(*) from public.programs pr join public.organizations o on o.id = pr.organization_id
                  where o.kind not in ('library', 'sandbox') and coalesce(pr.is_active, true)),
    'paused',   (select count(*) from public.programs pr join public.organizations o on o.id = pr.organization_id
                  where o.kind not in ('library', 'sandbox') and not coalesce(pr.is_active, true)),
    'players',  (select count(distinct m.user_id) from public.program_members m
                  where m.role = 'player' and m.status = 'active' and not coalesce(m.is_test, false)
                    and not public.is_sandbox_program(m.program_id)),
    'active_week', (select count(distinct m.user_id) from public.program_members m join public.profiles p on p.id = m.user_id
                     where m.role = 'player' and m.status = 'active' and not coalesce(m.is_test, false)
                       and not public.is_sandbox_program(m.program_id)
                       and p.last_seen_at > now() - interval '7 days'),
    'no_head_coach', coalesce((
      select jsonb_agg(jsonb_build_object('program_id', pr.id, 'program', pr.name, 'org', o.name) order by o.name, pr.name)
        from public.programs pr join public.organizations o on o.id = pr.organization_id
       where coalesce(pr.is_active, true) and o.kind not in ('library', 'sandbox')
         and not exists (select 1 from public.program_members m where m.program_id = pr.id and m.role = 'head_coach'
                          and m.status = 'active' and not coalesce(m.is_test, false))), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object('program_id', x.program_id, 'program', x.program, 'org', x.org, 'count', x.n, 'oldest', x.oldest) order by x.oldest)
        from (select pr.id as program_id, pr.name as program, o.name as org, count(*) as n, min(m.created_at) as oldest
                from public.program_members m join public.programs pr on pr.id = m.program_id
                join public.organizations o on o.id = pr.organization_id
               where m.status = 'pending' and m.created_at < now() - interval '3 days' and o.kind not in ('library', 'sandbox')
               group by pr.id, pr.name, o.name) x), '[]'::jsonb),
    'quiet', coalesce((
      select jsonb_agg(jsonb_build_object('program_id', x.id, 'program', x.name, 'org', x.org, 'last_active', x.last_active) order by x.last_active nulls first)
        from (select pr.id, pr.name, o.name as org,
                     (select max(p.last_seen_at) from public.program_members m join public.profiles p on p.id = m.user_id
                       where m.program_id = pr.id and m.status = 'active' and not coalesce(m.is_test, false)
                         and not public.is_platform_admin(m.user_id)) as last_active
                from public.programs pr join public.organizations o on o.id = pr.organization_id
               where coalesce(pr.is_active, true) and o.kind not in ('library', 'sandbox')) x
       where x.last_active is null or x.last_active < now() - interval '14 days'), '[]'::jsonb),
    'unread_messages', public.message_unread(),
    'library_items', (select count(*) from public.library_items),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('at', l.at, 'action', l.action, 'detail', l.detail,
                                          'program', pr.name, 'org', o.name) order by l.at desc, l.id desc)
        from (select * from public.platform_log order by at desc, id desc limit 25) l
        left join public.programs pr on pr.id = l.program_id
        left join public.organizations o on o.id = l.org_id), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_library()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'library_program_id', public.library_program_id(),
    'programs', (select count(*) from public.programs pr join public.organizations o on o.id = pr.organization_id
                  where o.kind not in ('library', 'sandbox') and coalesce(pr.is_active, true)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'ref_id', i.ref_id,
        'title', public._lib_title(i.kind, i.ref_id),
        'meta', public._lib_meta(i.kind, i.ref_id),
        'source', case when i.source_program_id = public.library_program_id() then 'Made in the Shared Library'
                       else coalesce(sp.name, 'a program') end,
        'source_org', so.short_name,
        'created_at', i.created_at,
        'starter', i.starter, 'offered', i.offered,
        'added', (select count(*) from public.library_picks k where k.item_id = i.id and k.status = 'added'),
        'dismissed', (select count(*) from public.library_picks k where k.item_id = i.id and k.status = 'dismissed')
      ) order by i.created_at desc)
        from public.library_items i
        left join public.programs sp on sp.id = i.source_program_id
        left join public.organizations so on so.id = sp.organization_id
       where public._lib_title(i.kind, i.ref_id) is not null), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.post_announcement_everywhere(p_message text, p_pinned boolean DEFAULT false)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.post_announcement_to(
    array(select pr.id from public.programs pr join public.organizations o on o.id = pr.organization_id
           where coalesce(pr.is_active, true) and o.kind not in ('library', 'sandbox')),
    p_message, p_pinned)
$function$;

CREATE OR REPLACE FUNCTION public.platform_search_people(p_query text)
 RETURNS TABLE(id uuid, name text, email text, profile_role text, programs text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and not exists (select 1 from public.program_members sm
                        where sm.user_id = p.id and public.is_sandbox_program(sm.program_id))
     order by p.name
     limit 20;
end;
$function$;

-- ── 6. Who can call what ────────────────────────────────────────
revoke all on function public._sandbox_has_rows(text, uuid) from public, anon, authenticated;
revoke all on function public.sandbox_overview(), public.sandbox_reset(), public.in_sandbox(),
  public.sandbox_program_id(), public.is_sandbox_program(uuid) from public, anon;
grant execute on function public.sandbox_overview(), public.sandbox_reset(), public.in_sandbox(),
  public.sandbox_program_id(), public.is_sandbox_program(uuid) to authenticated;

-- ── 7. Self-check ───────────────────────────────────────────────
do $$
declare v_pid uuid := public.sandbox_program_id();
begin
  if v_pid is null then raise exception 'Self-check: the sandbox program wasn''t created.'; end if;
  if (select join_code from public.programs where id = v_pid) is not null then
    raise exception 'Self-check: the sandbox must not have a team code.';
  end if;
  if public.is_sandbox_program(public.legacy_default_program_id()) then
    raise exception 'Self-check: the sandbox is pointing at a real program.';
  end if;
  if exists (select 1 from public.program_members m where m.program_id = v_pid
              and exists (select 1 from public.program_members o where o.user_id = m.user_id and o.program_id <> v_pid)) then
    raise exception 'Self-check: someone from a real program is in the sandbox.';
  end if;
end $$;

commit;

select 'yes' as sandbox_ready,
       (select o.name || ' / ' || pr.name from public.programs pr join public.organizations o on o.id = pr.organization_id
         where pr.id = public.sandbox_program_id()) as sandbox,
       (select count(*) from public.seasons where program_id = public.sandbox_program_id()) as seasons,
       (select count(*) from public.app_settings where program_id = public.sandbox_program_id()) as settings;
