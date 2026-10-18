-- ============================================================
-- 190_platform_pages.sql
--
-- PLATFORM ADMIN (step 1 of the rework): what the new Platform pages
-- read and do. Platform-admin only throughout.
--
--   * Trainers: an organization of kind 'trainer' (already allowed).
--     platform_create_trainer() makes the trainer and its one program in
--     one step; trainers start with Offseason training + Lifting on, and
--     In-season coaching, Playbook and Quizzes off.
--   * Private notes and a plan label per school/trainer
--     (platform_org_notes) -- only the platform admin can read them.
--   * Change log (platform_log): every platform action, with a date --
--     head coach changes, features on/off, pauses, renames, colors and
--     logos, new team codes, new schools/trainers/programs, announcements.
--   * Announcements to chosen programs: post_announcement_to(programs[]).
--     ("Every program" is the same call with all of them.)
--   * platform_home(): totals and the "Needs attention" lists.
--   * platform_programs() now also returns each organization's kind,
--     notes and plan, and each program's last activity.
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Private notes + plan ──────────────────────────────────
create table if not exists public.platform_org_notes (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  notes      text,
  plan       text,
  updated_at timestamptz not null default now()
);
alter table public.platform_org_notes enable row level security;
drop policy if exists "platform_notes_admin" on public.platform_org_notes;
create policy "platform_notes_admin" on public.platform_org_notes for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));
revoke all on public.platform_org_notes from anon;
grant select, insert, update, delete on public.platform_org_notes to authenticated;


-- ── 2. Change log ────────────────────────────────────────────
create table if not exists public.platform_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  action     text not null,
  org_id     uuid,
  program_id uuid,
  detail     text
);
create index if not exists platform_log_at_idx on public.platform_log (at desc);
create index if not exists platform_log_program_idx on public.platform_log (program_id, at desc);
alter table public.platform_log enable row level security;
drop policy if exists "platform_log_read" on public.platform_log;
create policy "platform_log_read" on public.platform_log for select to authenticated
  using (public.is_platform_admin(auth.uid()));
revoke all on public.platform_log from anon;
grant select on public.platform_log to authenticated;

create or replace function public._plog(p_action text, p_org uuid, p_program uuid, p_detail text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $$
  insert into public.platform_log (actor_id, action, org_id, program_id, detail)
  values (auth.uid(), p_action, coalesce(p_org, (select organization_id from public.programs where id = p_program)), p_program, p_detail)
$$;
revoke all on function public._plog(text, uuid, uuid, text) from public, anon, authenticated;

-- Program changes made by the platform admin (from the page or anywhere).
create or replace function public._plog_programs()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if not public.is_platform_admin(auth.uid()) then return new; end if;
  if tg_op = 'UPDATE' then
    if new.is_active is distinct from old.is_active then
      perform public._plog(case when new.is_active then 'Resumed program' else 'Paused program' end, null, new.id, new.name);
    end if;
    if new.name is distinct from old.name then
      perform public._plog('Renamed program', null, new.id, old.name || ' → ' || new.name);
    end if;
    if new.join_code is distinct from old.join_code then
      perform public._plog('New team code', null, new.id, new.name);
    end if;
    if new.logo_url is distinct from old.logo_url then
      perform public._plog('Changed program logo', null, new.id, new.name);
    end if;
    if (new.primary_color, new.secondary_color, new.accent_color) is distinct from (old.primary_color, old.secondary_color, old.accent_color) then
      perform public._plog('Changed program colors', null, new.id, new.name);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists plog_programs on public.programs;
create trigger plog_programs after update on public.programs
  for each row execute function public._plog_programs();

create or replace function public._plog_features()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if not public.is_platform_admin(auth.uid()) then return new; end if;
  if tg_op = 'INSERT' or new.enabled is distinct from old.enabled then
    perform public._plog(case when new.enabled then 'Feature on' else 'Feature off' end, null, new.program_id,
      case new.feature_key when 'offseason' then 'Offseason training' when 'lifting' then 'Lifting'
        when 'inseason' then 'In-season coaching' when 'playbook' then 'Playbook' when 'quizzes' then 'Quizzes'
        else new.feature_key end);
  end if;
  return new;
end $$;
drop trigger if exists plog_features on public.program_features;
create trigger plog_features after insert or update on public.program_features
  for each row execute function public._plog_features();

create or replace function public._plog_orgs()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if not public.is_platform_admin(auth.uid()) then return new; end if;
  if tg_op = 'INSERT' then
    perform public._plog(case when new.kind = 'trainer' then 'Added trainer' else 'Added school' end, new.id, null, new.name);
  elsif (new.name, new.short_name, new.primary_color, new.secondary_color, new.accent_color, new.logo_url)
        is distinct from (old.name, old.short_name, old.primary_color, old.secondary_color, old.accent_color, old.logo_url) then
    perform public._plog(case when new.kind = 'trainer' then 'Edited trainer' else 'Edited school' end, new.id, null, new.name);
  end if;
  return new;
end $$;
drop trigger if exists plog_orgs on public.organizations;
create trigger plog_orgs after insert or update on public.organizations
  for each row execute function public._plog_orgs();

revoke all on function public._plog_programs() from public, anon, authenticated;
revoke all on function public._plog_features() from public, anon, authenticated;
revoke all on function public._plog_orgs() from public, anon, authenticated;


-- ── 3. Head coach changes + new programs are logged too ──────
create or replace function public.platform_set_head_coach(p_program uuid, p_user uuid, p_head boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_name text;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.programs where id = p_program) then
    raise exception 'That program doesn''t exist.';
  end if;
  select name into v_name from public.profiles where id = p_user;

  if p_head then
    update public.profiles set role = 'coach'
     where id = p_user and role in ('pending_coach', 'pending_player');
    insert into public.program_members (program_id, user_id, role, status)
    values (p_program, p_user, 'head_coach', 'active')
    on conflict (program_id, user_id) do update set role = 'head_coach', status = 'active';
    update public.profiles set active_program_id = p_program
     where id = p_user and active_program_id is null;
    perform public._plog('Added head coach', null, p_program, v_name);
  else
    update public.program_members set role = 'coach'
     where program_id = p_program and user_id = p_user and role = 'head_coach';
    perform public._plog('Removed head coach', null, p_program, v_name || ' (now assistant coach)');
  end if;
end;
$function$;

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

  insert into public.seasons (program_id, name, is_current, start_date)
  select v_id, s.name, true, s.start_date from public.seasons s
   where s.program_id = v_tpl and s.is_current
   limit 1;

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

  perform public._plog('Added program', p_org, v_id, trim(p_name));
  return v_id;
end;
$function$;


-- ── 4. Trainers: organization + its program in one step ──────
create or replace function public.platform_create_trainer(p_name text, p_short text, p_primary text, p_secondary text, p_accent text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_org uuid; v_prog uuid; k text;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the trainer a name.'; end if;
  insert into public.organizations (name, short_name, kind, primary_color, secondary_color, accent_color, timezone)
  values (trim(p_name), nullif(trim(coalesce(p_short, '')), ''), 'trainer',
          coalesce(p_primary, '#1a3fa8'), coalesce(p_secondary, '#b0b8c8'), coalesce(p_accent, '#f0c040'), 'America/New_York')
  returning id into v_org;
  v_prog := public.platform_create_program(v_org, trim(p_name));
  -- Trainer defaults: In-season coaching, Playbook and Quizzes off.
  foreach k in array array['inseason', 'playbook', 'quizzes'] loop
    insert into public.program_features (program_id, feature_key, enabled) values (v_prog, k, false)
    on conflict (program_id, feature_key) do update set enabled = false;
  end loop;
  return v_prog;
end;
$function$;


-- ── 5. Announcements to chosen programs ──────────────────────
create or replace function public.post_announcement_to(p_programs uuid[], p_message text, p_pinned boolean default false)
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
    raise exception 'Only the platform admin can post to several programs.' using errcode = '42501';
  end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'Write a message first.'; end if;
  if coalesce(array_length(p_programs, 1), 0) = 0 then raise exception 'Pick at least one program.'; end if;
  select name into v_name from public.profiles where id = v_me;
  insert into public.announcements (program_id, coach_id, coach_name, message, is_pinned, broadcast_id, created_at)
  select p.id, v_me, v_name, trim(p_message), coalesce(p_pinned, false), v_id, now()
    from public.programs p
   where p.id = any(p_programs) and coalesce(p.is_active, true);
  get diagnostics n = row_count;
  perform public._plog('Announcement', null, null,
    n || ' program' || case when n = 1 then '' else 's' end || ': ' || left(trim(p_message), 80));
  return n;
end;
$function$;

create or replace function public.post_announcement_everywhere(p_message text, p_pinned boolean default false)
 returns integer
 language sql
 security definer
 set search_path to 'public'
as $function$
  select public.post_announcement_to(array(select id from public.programs where coalesce(is_active, true)), p_message, p_pinned)
$function$;


-- ── 6. Overview with kind, notes, plan, last activity ────────
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
    from public.organizations o
    left join public.platform_org_notes n on n.org_id = o.id), '[]'::jsonb);
end;
$function$;


-- ── 7. Home: totals + needs attention + recent changes ───────
create or replace function public.platform_home()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'schools',  (select count(*) from public.organizations where kind = 'school'),
    'trainers', (select count(*) from public.organizations where kind = 'trainer'),
    'programs', (select count(*) from public.programs where coalesce(is_active, true)),
    'paused',   (select count(*) from public.programs where not coalesce(is_active, true)),
    'players',  (select count(distinct m.user_id) from public.program_members m
                  where m.role = 'player' and m.status = 'active' and not coalesce(m.is_test, false)),
    'active_week', (select count(distinct m.user_id) from public.program_members m join public.profiles p on p.id = m.user_id
                     where m.role = 'player' and m.status = 'active' and not coalesce(m.is_test, false)
                       and p.last_seen_at > now() - interval '7 days'),
    'no_head_coach', coalesce((
      select jsonb_agg(jsonb_build_object('program_id', pr.id, 'program', pr.name, 'org', o.name) order by o.name, pr.name)
        from public.programs pr join public.organizations o on o.id = pr.organization_id
       where coalesce(pr.is_active, true)
         and not exists (select 1 from public.program_members m where m.program_id = pr.id and m.role = 'head_coach'
                          and m.status = 'active' and not coalesce(m.is_test, false))), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object('program_id', x.program_id, 'program', x.program, 'org', x.org, 'count', x.n, 'oldest', x.oldest) order by x.oldest)
        from (select pr.id as program_id, pr.name as program, o.name as org, count(*) as n, min(m.created_at) as oldest
                from public.program_members m join public.programs pr on pr.id = m.program_id
                join public.organizations o on o.id = pr.organization_id
               where m.status = 'pending' and m.created_at < now() - interval '3 days'
               group by pr.id, pr.name, o.name) x), '[]'::jsonb),
    'quiet', coalesce((
      select jsonb_agg(jsonb_build_object('program_id', x.id, 'program', x.name, 'org', x.org, 'last_active', x.last_active) order by x.last_active nulls first)
        from (select pr.id, pr.name, o.name as org,
                     (select max(p.last_seen_at) from public.program_members m join public.profiles p on p.id = m.user_id
                       where m.program_id = pr.id and m.status = 'active' and not coalesce(m.is_test, false)
                         and not public.is_platform_admin(m.user_id)) as last_active
                from public.programs pr join public.organizations o on o.id = pr.organization_id
               where coalesce(pr.is_active, true)) x
       where x.last_active is null or x.last_active < now() - interval '14 days'), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('at', l.at, 'action', l.action, 'detail', l.detail,
                                          'program', pr.name, 'org', o.name) order by l.at desc, l.id desc)
        from (select * from public.platform_log order by at desc, id desc limit 25) l
        left join public.programs pr on pr.id = l.program_id
        left join public.organizations o on o.id = l.org_id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.platform_program_log(p_program uuid)
 returns table(at timestamptz, action text, detail text)
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select l.at, l.action, l.detail from public.platform_log l
   where public.is_platform_admin(auth.uid()) and l.program_id = p_program
   order by l.at desc, l.id desc limit 30
$$;


-- ── 8. Who can call these ────────────────────────────────────
revoke all on function public.platform_create_trainer(text, text, text, text, text) from public, anon;
revoke all on function public.post_announcement_to(uuid[], text, boolean) from public, anon;
revoke all on function public.platform_home() from public, anon;
revoke all on function public.platform_program_log(uuid) from public, anon;
grant execute on function public.platform_create_trainer(text, text, text, text, text) to authenticated;
grant execute on function public.post_announcement_to(uuid[], text, boolean) to authenticated;
grant execute on function public.platform_home() to authenticated;
grant execute on function public.platform_program_log(uuid) to authenticated;

commit;


-- ── Check ─────────────────────────────────────────────────────
select 'organizations' as item, string_agg(name || ' (' || kind || ')', ', ' order by name) as value from public.organizations
union all select 'platform tables', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('platform_org_notes', 'platform_log')) || ' of 2'
union all select 'home loads', case when (select count(*) from pg_proc where proname = 'platform_home') = 1 then 'yes' else 'NO' end;
