-- 194_shared_library.sql
-- The Shared Library (platform step 4).
--
-- * A hidden "Shared Library" program holds the library's copies. Only the
--   platform admin can enter it (it has no members and no team code), and
--   there the normal Drills / Playbook / Practice / Lifting pages edit them.
-- * library_items lists what's in the library, with two switches:
--     starter  -> copied into a new program when it gets its first head coach
--     offered  -> shown to existing programs' head coaches under "New"
-- * Copies are real, independent rows: adding to the library never changes
--   the original, and a program's copy is theirs to edit.
-- * Kinds: player drills (workouts), team drills (practice_drills_library),
--   practice templates, plays and lifting programs. Quizzes stay out.
--
-- Nothing in an existing program changes here; the self-check at the end
-- compares every program's content counts before and after.

begin;

-- ── 0. Before-counts for the self-check ─────────────────────────
create temp table _lib_before on commit drop as
select pr.id as program_id,
       (select count(*) from public.workouts w where w.program_id = pr.id) as workouts,
       (select count(*) from public.plays p where p.program_id = pr.id) as plays,
       (select count(*) from public.practice_drills_library d where d.program_id = pr.id) as team_drills,
       (select count(*) from public.practices x where x.program_id = pr.id) as practices,
       (select count(*) from public.lifting_programs l where l.program_id = pr.id) as lifting,
       (select count(*) from public.program_members m where m.program_id = pr.id) as members
  from public.programs pr;

-- ── 1. The hidden library program ───────────────────────────────
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
  check (kind in ('school', 'trainer', 'library'));

do $$
declare
  v_org  uuid;
  v_prog uuid;
  v_tpl  uuid := public.legacy_default_program_id();
begin
  select id into v_org from public.organizations where kind = 'library' order by created_at limit 1;
  if v_org is null then
    insert into public.organizations (name, short_name, kind, primary_color, secondary_color, accent_color, timezone)
    values ('Shared Library', 'SL', 'library', '#1a3fa8', '#b0b8c8', '#f0c040', 'America/New_York')
    returning id into v_org;
  end if;

  select id into v_prog from public.programs where organization_id = v_org order by created_at limit 1;
  if v_prog is null then
    -- No team code: nobody can join it.
    insert into public.programs (organization_id, name, primary_color, secondary_color, accent_color, is_active, join_code)
    values (v_org, 'Shared Library', '#1a3fa8', '#b0b8c8', '#f0c040', true, null)
    returning id into v_prog;

    -- Same settings a new program gets, so every page opens normally in it.
    insert into public.seasons (program_id, name, is_current, start_date)
    select v_prog, s.name, true, s.start_date from public.seasons s
     where s.program_id = v_tpl and s.is_current
     limit 1;
    insert into public.app_settings (program_id, key, value, updated_at)
    select v_prog, s.key, s.value, now() from public.app_settings s where s.program_id = v_tpl
    on conflict (program_id, key) do nothing;
    insert into public.xp_settings (program_id, perk_key, perk_name, xp_required, description, updated_at)
    select v_prog, x.perk_key, x.perk_name, x.xp_required, x.description, now()
      from public.xp_settings x where x.program_id = v_tpl
    on conflict (program_id, perk_key) do nothing;
  end if;
end $$;

create or replace function public.library_program_id()
returns uuid language sql stable security definer set search_path = public as $$
  select pr.id from public.programs pr
    join public.organizations o on o.id = pr.organization_id
   where o.kind = 'library'
   order by pr.created_at
   limit 1
$$;

-- ── 2. Tables ───────────────────────────────────────────────────
create table if not exists public.library_items (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('drill', 'team_drill', 'template', 'play', 'lifting')),
  ref_id            uuid not null unique,          -- the row in the library program
  source_program_id uuid references public.programs(id) on delete set null,
  source_id         uuid,
  starter           boolean not null default false,
  offered           boolean not null default false,
  offered_at        timestamptz,
  added_by          uuid,
  created_at        timestamptz not null default now()
);

-- Which row in a program is the copy of which source row, so the same
-- drill isn't copied twice (e.g. two templates that use it).
create table if not exists public.library_copies (
  target_program uuid not null references public.programs(id) on delete cascade,
  src_table      text not null,
  src_id         uuid not null,
  copy_id        uuid not null,
  created_at     timestamptz not null default now(),
  primary key (target_program, src_table, src_id)
);

-- A program's answer to an offered item: added, or "not now".
create table if not exists public.library_picks (
  program_id uuid not null references public.programs(id) on delete cascade,
  item_id    uuid not null references public.library_items(id) on delete cascade,
  status     text not null check (status in ('added', 'dismissed')),
  copy_id    uuid,
  by_user    uuid,
  at         timestamptz not null default now(),
  primary key (program_id, item_id)
);

-- Programs that have had their starter pack (or never get one).
create table if not exists public.library_starter_done (
  program_id uuid primary key references public.programs(id) on delete cascade,
  at         timestamptz not null default now(),
  items      int not null default 0
);

-- Only the functions below touch these.
alter table public.library_items        enable row level security;
alter table public.library_copies       enable row level security;
alter table public.library_picks        enable row level security;
alter table public.library_starter_done enable row level security;
revoke all on public.library_items, public.library_copies, public.library_picks, public.library_starter_done
  from anon, authenticated;

-- ── 3. Copy engine (internal) ───────────────────────────────────
create or replace function public._lib_table(p_kind text)
returns regclass language sql stable as $$
  select case p_kind
    when 'drill'      then 'public.workouts'::regclass
    when 'team_drill' then 'public.practice_drills_library'::regclass
    when 'template'   then 'public.practices'::regclass
    when 'play'       then 'public.plays'::regclass
    when 'lifting'    then 'public.lifting_programs'::regclass
  end
$$;

-- Copies one row, every column, with the patch applied on top. Reading the
-- columns from the table itself means a column this file doesn't know
-- about still comes along.
create or replace function public._lib_clone(p_tbl regclass, p_src uuid, p_patch jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_row  jsonb;
  v_id   uuid := gen_random_uuid();
  v_cols text;
begin
  execute format('select to_jsonb(t) from %s t where t.id = $1', p_tbl) into v_row using p_src;
  if v_row is null then return null; end if;
  select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
    from pg_attribute
   where attrelid = p_tbl and attnum > 0 and not attisdropped
     and attgenerated = '' and attidentity = '';
  execute format('insert into %1$s (%2$s) select %2$s from jsonb_populate_record(null::%1$s, $1)', p_tbl, v_cols)
    using v_row || coalesce(p_patch, '{}'::jsonb) || jsonb_build_object('id', v_id);
  return v_id;
end $$;

-- Removes keys anywhere in a JSON value (used to take player
-- assignments out of a play's drawing).
create or replace function public._lib_strip(j jsonb, k text[])
returns jsonb language plpgsql immutable as $$
begin
  if j is null then return null; end if;
  case jsonb_typeof(j)
    when 'object' then
      return coalesce((select jsonb_object_agg(e.key, public._lib_strip(e.value, k))
                         from jsonb_each(j) e where not (e.key = any(k))), '{}'::jsonb);
    when 'array' then
      return coalesce((select jsonb_agg(public._lib_strip(e.value, k) order by e.ord)
                         from jsonb_array_elements(j) with ordinality e(value, ord)), '[]'::jsonb);
    else
      return j;
  end case;
end $$;

create or replace function public._lib_map_get(p_target uuid, p_tbl regclass, p_src uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; ok boolean;
begin
  select copy_id into v from public.library_copies
   where target_program = p_target and src_table = p_tbl::text and src_id = p_src;
  if v is null then return null; end if;
  execute format('select exists (select 1 from %s where id = $1 and program_id = $2)', p_tbl) into ok using v, p_target;
  if ok then return v; end if;
  delete from public.library_copies where target_program = p_target and src_table = p_tbl::text and src_id = p_src;
  return null;
end $$;

create or replace function public._lib_map_put(p_target uuid, p_tbl regclass, p_src uuid, p_copy uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.library_copies (target_program, src_table, src_id, copy_id)
  values (p_target, p_tbl::text, p_src, p_copy)
  on conflict (target_program, src_table, src_id) do update set copy_id = excluded.copy_id, created_at = now()
$$;

-- Makes sure a category exists in the target program (categories are
-- per program and drills/plays point at them by name).
create or replace function public._lib_ensure_cat(p_tbl regclass, p_target uuid, p_name text, p_src_prog uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_name is null or p_name = '' then return; end if;
  execute format(
    'insert into %1$s (program_id, name, sort_order)
     select $1, $2, coalesce((select sort_order from %1$s where program_id = $3 and name = $2 limit 1),
                             (select coalesce(max(sort_order), 0) + 1 from %1$s where program_id = $1))
      where not exists (select 1 from %1$s where program_id = $1 and name = $2)', p_tbl)
  using p_target, p_name, p_src_prog;
end $$;

-- Who owns copies in a program when nobody in particular asked: its first
-- real head coach, else the caller.
create or replace function public._lib_owner(p_pid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce((
    select pm.user_id from public.program_members pm
     where pm.program_id = p_pid and pm.role = 'head_coach' and pm.status = 'active'
       and not coalesce(pm.is_test, false)
       and not public.is_platform_admin(pm.user_id)
     order by pm.created_at
     limit 1), auth.uid())
$$;

create or replace function public._lib_copy_play(p_src uuid, p_target uuid, p_owner uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.plays%rowtype; v uuid;
begin
  v := public._lib_map_get(p_target, 'public.plays', p_src);
  if v is not null then return v; end if;
  select * into r from public.plays where id = p_src;
  if not found then return null; end if;
  perform public._lib_ensure_cat('public.plays_categories', p_target, r.category, r.program_id);
  v := public._lib_clone('public.plays', p_src, jsonb_build_object(
         'program_id', p_target, 'created_by', p_owner, 'forked_from', null,
         'created_at', now(), 'updated_at', now(),
         -- which roster player stood where is the old team's business
         'data', public._lib_strip(r.data, array['profile_id'])));
  perform public._lib_map_put(p_target, 'public.plays', p_src, v);
  return v;
end $$;

create or replace function public._lib_copy_workout(p_src uuid, p_target uuid, p_owner uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.workouts%rowtype; v uuid;
begin
  v := public._lib_map_get(p_target, 'public.workouts', p_src);
  if v is not null then return v; end if;
  select * into r from public.workouts where id = p_src;
  if not found then return null; end if;
  perform public._lib_ensure_cat('public.drill_categories', p_target, r.category, r.program_id);
  -- Arrives switched off, like the drills copied to Girls in 184.
  v := public._lib_clone('public.workouts', p_src, jsonb_build_object(
         'program_id', p_target, 'coach_id', p_owner,
         'is_active', false, 'leaderboard_active', true, 'library_archived', false, 'current_run', 1,
         'group_id', null, 'group_name', null, 'deadline', null, 'publish_date', null,
         'created_at', now()));
  perform public._lib_map_put(p_target, 'public.workouts', p_src, v);
  return v;
end $$;

create or replace function public._lib_copy_team_drill(p_src uuid, p_target uuid, p_owner uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.practice_drills_library%rowtype; v uuid; v_play uuid;
begin
  v := public._lib_map_get(p_target, 'public.practice_drills_library', p_src);
  if v is not null then return v; end if;
  select * into r from public.practice_drills_library where id = p_src;
  if not found then return null; end if;
  perform public._lib_ensure_cat('public.practice_drill_categories', p_target, r.category_name, r.program_id);
  if r.linked_play_id is not null then
    v_play := public._lib_copy_play(r.linked_play_id, p_target, p_owner);
  end if;
  v := public._lib_clone('public.practice_drills_library', p_src, jsonb_build_object(
         'program_id', p_target, 'created_by', p_owner, 'is_starred', false,
         'linked_play_id', v_play, 'created_at', now(), 'updated_at', now()));

  insert into public.practice_drill_tags (program_id, name)
  select distinct p_target, l.tag_name from public.practice_drill_tag_links l
   where l.drill_id = p_src
     and not exists (select 1 from public.practice_drill_tags t where t.program_id = p_target and t.name = l.tag_name);
  insert into public.practice_drill_tag_links (drill_id, tag_name, program_id)
  select distinct v, l.tag_name, p_target from public.practice_drill_tag_links l where l.drill_id = p_src;

  perform public._lib_map_put(p_target, 'public.practice_drills_library', p_src, v);
  return v;
end $$;

-- A template: its blocks, one whole-team segment per block (roster splits
-- and named coaches/players belong to the old team), and its drills.
create or replace function public._lib_copy_template(p_src uuid, p_target uuid, p_owner uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r  public.practices%rowtype;
  v  uuid; b record; s record; d record;
  nb uuid; ns uuid; i int;
begin
  v := public._lib_map_get(p_target, 'public.practices', p_src);
  if v is not null then return v; end if;
  select * into r from public.practices where id = p_src;
  if not found or not coalesce(r.is_template, false) then return null; end if;

  v := public._lib_clone('public.practices', p_src, jsonb_build_object(
         'program_id', p_target, 'created_by', p_owner, 'week_id', null, 'roster_ids', '[]'::jsonb,
         'status', 'draft', 'attendance_taken_at', null, 'is_template', true, 'is_tryout', false,
         'practice_date', current_date, 'created_at', now(), 'updated_at', now()));

  for b in select id from public.practice_blocks where practice_id = p_src order by order_index loop
    nb := public._lib_clone('public.practice_blocks', b.id, jsonb_build_object(
            'practice_id', v, 'program_id', p_target, 'created_at', now()));
    ns := null; i := 0;
    for s in select id from public.block_segments where block_id = b.id order by created_at, id loop
      if ns is null then
        ns := public._lib_clone('public.block_segments', s.id, jsonb_build_object(
                'block_id', nb, 'program_id', p_target, 'scope_type', 'combined', 'roster_id', null,
                'created_at', now()));
      end if;
      for d in select id, drill_id from public.segment_drills where segment_id = s.id order by order_index loop
        perform public._lib_clone('public.segment_drills', d.id, jsonb_build_object(
          'segment_id', ns, 'program_id', p_target,
          'drill_id', case when d.drill_id is null then null
                           else public._lib_copy_team_drill(d.drill_id, p_target, p_owner) end,
          'order_index', i, 'coach_name', null, 'coach_ids', '[]'::jsonb,
          'station_member_ids', '[]'::jsonb, 'station_tryout_member_ids', '[]'::jsonb,
          'split_overrides', '{}'::jsonb, 'created_at', now()));
        i := i + 1;
      end loop;
    end loop;
  end loop;

  perform public._lib_map_put(p_target, 'public.practices', p_src, v);
  return v;
end $$;

-- An exercise-bank entry by name: reuse the target's if it has one.
create or replace function public._lib_bank(p_src uuid, p_target uuid, p_owner uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text; v uuid;
begin
  if p_src is null then return null; end if;
  select name into v_name from public.lifting_exercise_bank where id = p_src;
  if v_name is null then return null; end if;
  select id into v from public.lifting_exercise_bank where program_id = p_target and name = v_name limit 1;
  if v is not null then return v; end if;
  return public._lib_clone('public.lifting_exercise_bank', p_src, jsonb_build_object(
           'program_id', p_target, 'created_by', p_owner, 'created_at', now()));
end $$;

-- A lifting program: days and exercises, no assignments. Arrives as a
-- draft so players don't see it until the coach is ready.
create or replace function public._lib_copy_lifting(p_src uuid, p_target uuid, p_owner uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.lifting_programs%rowtype; v uuid; d record; e record; nd uuid;
begin
  v := public._lib_map_get(p_target, 'public.lifting_programs', p_src);
  if v is not null then return v; end if;
  select * into r from public.lifting_programs where id = p_src;
  if not found or r.visibility = 'personal' then return null; end if;

  v := public._lib_clone('public.lifting_programs', p_src, jsonb_build_object(
         'program_id', p_target, 'created_by', p_owner, 'visibility', 'draft',
         'is_active', true, 'archived', false, 'start_date', null, 'created_at', now()));
  for d in select id from public.lifting_days where lifting_program_id = p_src order by day_number loop
    nd := public._lib_clone('public.lifting_days', d.id, jsonb_build_object(
            'lifting_program_id', v, 'program_id', p_target, 'created_at', now()));
    for e in select id, bank_exercise_id from public.lifting_day_exercises where day_id = d.id loop
      perform public._lib_clone('public.lifting_day_exercises', e.id, jsonb_build_object(
        'day_id', nd, 'program_id', p_target,
        'bank_exercise_id', public._lib_bank(e.bank_exercise_id, p_target, p_owner)));
    end loop;
  end loop;
  for e in select id from public.lifting_exercises where lifting_program_id = p_src loop
    perform public._lib_clone('public.lifting_exercises', e.id, jsonb_build_object(
      'lifting_program_id', v, 'program_id', p_target));
  end loop;

  perform public._lib_map_put(p_target, 'public.lifting_programs', p_src, v);
  return v;
end $$;

create or replace function public._lib_copy(p_kind text, p_src uuid, p_target uuid, p_owner uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return case p_kind
    when 'drill'      then public._lib_copy_workout(p_src, p_target, p_owner)
    when 'team_drill' then public._lib_copy_team_drill(p_src, p_target, p_owner)
    when 'template'   then public._lib_copy_template(p_src, p_target, p_owner)
    when 'play'       then public._lib_copy_play(p_src, p_target, p_owner)
    when 'lifting'    then public._lib_copy_lifting(p_src, p_target, p_owner)
  end;
end $$;

create or replace function public._lib_title(p_kind text, p_ref uuid)
returns text language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'drill'      then (select title from public.workouts where id = p_ref)
    when 'team_drill' then (select title from public.practice_drills_library where id = p_ref)
    when 'template'   then (select coalesce(template_name, 'Untitled template') from public.practices where id = p_ref)
    when 'play'       then (select title from public.plays where id = p_ref)
    when 'lifting'    then (select title from public.lifting_programs where id = p_ref)
  end
$$;

create or replace function public._lib_meta(p_kind text, p_ref uuid)
returns text language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'drill'      then (select category from public.workouts where id = p_ref)
    when 'team_drill' then (select category_name from public.practice_drills_library where id = p_ref)
    when 'template'   then (select count(*) || ' block' || case when count(*) = 1 then '' else 's' end
                              from public.practice_blocks where practice_id = p_ref)
    when 'play'       then (select category from public.plays where id = p_ref)
    when 'lifting'    then (select count(*) || ' day' || case when count(*) = 1 then '' else 's' end
                              from public.lifting_days where lifting_program_id = p_ref)
  end
$$;

-- ── 4. Starter pack ─────────────────────────────────────────────
create or replace function public._lib_apply_starter(p_pid uuid, p_owner uuid)
returns int language plpgsql security definer set search_path = public as $$
declare it record; v uuid; n int := 0;
begin
  if p_pid is null or p_pid = public.library_program_id()
     or exists (select 1 from public.library_starter_done where program_id = p_pid) then
    return 0;
  end if;
  insert into public.library_starter_done (program_id) values (p_pid);
  for it in select * from public.library_items where starter order by created_at loop
    continue when exists (select 1 from public.library_picks where program_id = p_pid and item_id = it.id);
    continue when it.source_program_id = p_pid;
    begin
      v := public._lib_copy(it.kind, it.ref_id, p_pid, p_owner);
      if v is not null then
        insert into public.library_picks (program_id, item_id, status, copy_id, by_user)
        values (p_pid, it.id, 'added', v, p_owner)
        on conflict (program_id, item_id) do nothing;
        n := n + 1;
      end if;
    exception when others then
      raise warning 'Starter pack: skipped % (%)', it.id, sqlerrm;
    end;
  end loop;
  update public.library_starter_done set items = n where program_id = p_pid;
  if n > 0 then
    perform public._plog('Starter pack added', null, p_pid, n || ' item' || case when n = 1 then '' else 's' end);
  end if;
  return n;
end $$;

-- A program's first head coach brings in the starter pack, owned by them.
-- Never blocks the membership change itself.
create or replace function public._lib_starter_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'head_coach' and new.status = 'active' and not coalesce(new.is_test, false)
     and not exists (select 1 from public.library_starter_done where program_id = new.program_id) then
    begin
      perform public._lib_apply_starter(new.program_id, new.user_id);
    exception when others then
      raise warning 'Starter pack not added: %', sqlerrm;
    end;
  end if;
  return null;
end $$;

drop trigger if exists program_members_starter on public.program_members;
create trigger program_members_starter
  after insert or update of role, status on public.program_members
  for each row execute function public._lib_starter_trg();

-- Programs that already have a head coach are past the starter stage;
-- they get offered items under "New" instead.
insert into public.library_starter_done (program_id)
select pr.id from public.programs pr
 where pr.id = public.library_program_id()
    or exists (select 1 from public.program_members m
                where m.program_id = pr.id and m.role = 'head_coach' and m.status = 'active'
                  and not coalesce(m.is_test, false))
on conflict (program_id) do nothing;

-- ── 5. Platform admin: add, list, switch, remove ────────────────
create or replace function public.library_add(p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lib    uuid := public.library_program_id();
  v_tbl    regclass;
  v_src    uuid;
  v_ref    uuid;
  v_item   uuid;
  v_status text := 'added';
  v_title  text;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  v_tbl := public._lib_table(p_kind);
  if v_tbl is null then raise exception 'That can''t go in the Shared Library.'; end if;
  execute format('select program_id from %s where id = $1', v_tbl) into v_src using p_id;
  if v_src is null then raise exception 'Couldn''t find that item.'; end if;
  if p_kind = 'template' and not coalesce((select is_template from public.practices where id = p_id), false) then
    raise exception 'Only saved practice templates can be added.';
  end if;
  if p_kind = 'lifting' and (select visibility from public.lifting_programs where id = p_id) = 'personal' then
    raise exception 'A player''s personal lifting program can''t be shared.';
  end if;

  if v_src = v_lib then
    v_ref := p_id;                        -- made right in the library
  else
    v_ref := public._lib_map_get(v_lib, v_tbl, p_id);
    if v_ref is null then
      v_ref := public._lib_copy(p_kind, p_id, v_lib, auth.uid());
    end if;
  end if;
  if v_ref is null then raise exception 'Couldn''t copy that item.'; end if;

  select id into v_item from public.library_items where ref_id = v_ref;
  if v_item is null then
    insert into public.library_items (kind, ref_id, source_program_id, source_id, added_by)
    values (p_kind, v_ref, v_src, p_id, auth.uid())
    returning id into v_item;
  else
    v_status := 'already';
  end if;

  v_title := public._lib_title(p_kind, v_ref);
  if v_status = 'added' then
    perform public._plog('Added to Shared Library', null, v_src, v_title);
  end if;
  return jsonb_build_object('status', v_status, 'item_id', v_item, 'title', v_title);
end $$;

-- What a program has of one kind, for "Add from a program" on the Shared
-- Library page. (Plays are private to the coach who drew them, so the
-- platform admin can't reach them from the program's own pages.)
create or replace function public.library_browse(p_program uuid, p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_lib uuid := public.library_program_id();
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'title', x.title, 'meta', x.meta,
      'in_library', exists (select 1 from public.library_copies c join public.library_items i on i.ref_id = c.copy_id
                             where c.target_program = v_lib and c.src_id = x.id)
                    or exists (select 1 from public.library_items i where i.ref_id = x.id))
      order by lower(x.title))
    from (
      select w.id, w.title, w.category as meta from public.workouts w
       where p_kind = 'drill' and w.program_id = p_program and w.library_archived is not true
      union all
      select d.id, d.title, d.category_name from public.practice_drills_library d
       where p_kind = 'team_drill' and d.program_id = p_program
      union all
      select t.id, coalesce(t.template_name, 'Untitled template'), t.roster_label from public.practices t
       where p_kind = 'template' and t.program_id = p_program and t.is_template
      union all
      select p.id, p.title, nullif(concat_ws(' · ', nullif(p.category, ''), 'by ' || (select name from public.profiles where id = p.created_by)), '')
        from public.plays p
       where p_kind = 'play' and p.program_id = p_program
      union all
      select l.id, l.title, case l.visibility when 'public' then 'Everyone' when 'draft' then 'Draft' else 'Assigned players' end
        from public.lifting_programs l
       where p_kind = 'lifting' and l.program_id = p_program
         and coalesce(l.visibility, '') <> 'personal' and l.archived is not true
    ) x), '[]'::jsonb);
end $$;

-- Which of these ids are already in the library (for the button's label).
create or replace function public.library_in_library(p_ids uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select case when not public.is_platform_admin(auth.uid()) then '{}'::uuid[] else coalesce((
    select array_agg(distinct x) from (
      select c.src_id as x from public.library_copies c
        join public.library_items i on i.ref_id = c.copy_id
       where c.target_program = public.library_program_id() and c.src_id = any(p_ids)
      union all
      select i.ref_id from public.library_items i where i.ref_id = any(p_ids)) q), '{}'::uuid[]) end
$$;

create or replace function public.platform_library()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'library_program_id', public.library_program_id(),
    'programs', (select count(*) from public.programs pr join public.organizations o on o.id = pr.organization_id
                  where o.kind <> 'library' and coalesce(pr.is_active, true)),
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
end $$;

create or replace function public.library_set(p_item uuid, p_starter boolean default null, p_offered boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare it public.library_items%rowtype;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  select * into it from public.library_items where id = p_item;
  if not found then raise exception 'That item is no longer in the Shared Library.'; end if;
  update public.library_items
     set starter    = coalesce(p_starter, starter),
         offered    = coalesce(p_offered, offered),
         offered_at = case when p_offered and not it.offered then now() else offered_at end
   where id = p_item;
  if p_offered is not null and p_offered <> it.offered then
    perform public._plog(case when p_offered then 'Offered from Shared Library' else 'Stopped offering' end,
                         null, null, public._lib_title(it.kind, it.ref_id));
  end if;
end $$;

-- Takes an item out of the library. Programs that added it keep their copy.
create or replace function public.library_remove(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it public.library_items%rowtype; v_lib uuid := public.library_program_id(); v_title text;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  select * into it from public.library_items where id = p_item;
  if not found then return; end if;
  v_title := public._lib_title(it.kind, it.ref_id);
  delete from public.library_items where id = p_item;
  -- Still used by a template or team drill in the library: keep the row,
  -- it just stops being its own item.
  if (it.kind = 'team_drill' and exists (select 1 from public.segment_drills where drill_id = it.ref_id))
     or (it.kind = 'play' and exists (select 1 from public.practice_drills_library where linked_play_id = it.ref_id)) then
    perform public._plog('Removed from Shared Library', null, null, v_title);
    return;
  end if;
  delete from public.library_copies where target_program = v_lib and copy_id = it.ref_id;
  begin
    execute format('delete from %s where id = $1 and program_id = $2', public._lib_table(it.kind))
      using it.ref_id, v_lib;
  exception when others then
    null;   -- still referenced by something in the library; the item is gone either way
  end;
  perform public._plog('Removed from Shared Library', null, null, v_title);
end $$;

-- ── 6. Head coaches: "New" ──────────────────────────────────────
create or replace function public.library_new(p_kinds text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public.current_program_id();
begin
  if v_pid is null or v_pid = public.library_program_id()
     or not public.is_program_head_coach(v_pid, auth.uid()) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'kind', i.kind,
      'title', public._lib_title(i.kind, i.ref_id),
      'meta', public._lib_meta(i.kind, i.ref_id),
      'offered_at', i.offered_at) order by i.offered_at desc nulls last, i.created_at desc)
      from public.library_items i
     where i.offered and i.kind = any(p_kinds)
       and i.source_program_id is distinct from v_pid
       and not exists (select 1 from public.library_picks k where k.program_id = v_pid and k.item_id = i.id)
       and public._lib_title(i.kind, i.ref_id) is not null), '[]'::jsonb);
end $$;

create or replace function public.library_pick(p_item uuid, p_add boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pid   uuid := public.current_program_id();
  v_uid   uuid := auth.uid();
  it      public.library_items%rowtype;
  v_owner uuid;
  v_copy  uuid;
begin
  if v_pid is null or v_pid = public.library_program_id()
     or not public.is_program_head_coach(v_pid, v_uid) then
    raise exception 'Only a head coach can add from the Shared Library.' using errcode = '42501';
  end if;
  select * into it from public.library_items where id = p_item;
  if not found then raise exception 'That item is no longer in the Shared Library.'; end if;

  if p_add then
    -- A head coach owns what they add; when the platform admin adds it for
    -- a program, the program's head coach does.
    v_owner := case when public.is_platform_admin(v_uid) then public._lib_owner(v_pid) else v_uid end;
    v_copy := public._lib_copy(it.kind, it.ref_id, v_pid, v_owner);
    if v_copy is null then raise exception 'Couldn''t copy that item.'; end if;
  end if;

  insert into public.library_picks (program_id, item_id, status, copy_id, by_user)
  values (v_pid, p_item, case when p_add then 'added' else 'dismissed' end, v_copy, v_uid)
  on conflict (program_id, item_id) do update
    set status = excluded.status, copy_id = coalesce(excluded.copy_id, public.library_picks.copy_id),
        by_user = excluded.by_user, at = now();

  return jsonb_build_object('kind', it.kind, 'title', public._lib_title(it.kind, it.ref_id), 'copy_id', v_copy);
end $$;

-- ── 7. Keep the library out of the program lists ────────────────
create or replace function public.platform_programs()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
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
   where o.kind <> 'library'), '[]'::jsonb);
end;
$function$;

create or replace function public.platform_home()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'schools',  (select count(*) from public.organizations where kind = 'school'),
    'trainers', (select count(*) from public.organizations where kind = 'trainer'),
    'programs', (select count(*) from public.programs pr join public.organizations o on o.id = pr.organization_id
                  where o.kind <> 'library' and coalesce(pr.is_active, true)),
    'paused',   (select count(*) from public.programs pr join public.organizations o on o.id = pr.organization_id
                  where o.kind <> 'library' and not coalesce(pr.is_active, true)),
    'players',  (select count(distinct m.user_id) from public.program_members m
                  where m.role = 'player' and m.status = 'active' and not coalesce(m.is_test, false)),
    'active_week', (select count(distinct m.user_id) from public.program_members m join public.profiles p on p.id = m.user_id
                     where m.role = 'player' and m.status = 'active' and not coalesce(m.is_test, false)
                       and p.last_seen_at > now() - interval '7 days'),
    'no_head_coach', coalesce((
      select jsonb_agg(jsonb_build_object('program_id', pr.id, 'program', pr.name, 'org', o.name) order by o.name, pr.name)
        from public.programs pr join public.organizations o on o.id = pr.organization_id
       where coalesce(pr.is_active, true) and o.kind <> 'library'
         and not exists (select 1 from public.program_members m where m.program_id = pr.id and m.role = 'head_coach'
                          and m.status = 'active' and not coalesce(m.is_test, false))), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object('program_id', x.program_id, 'program', x.program, 'org', x.org, 'count', x.n, 'oldest', x.oldest) order by x.oldest)
        from (select pr.id as program_id, pr.name as program, o.name as org, count(*) as n, min(m.created_at) as oldest
                from public.program_members m join public.programs pr on pr.id = m.program_id
                join public.organizations o on o.id = pr.organization_id
               where m.status = 'pending' and m.created_at < now() - interval '3 days' and o.kind <> 'library'
               group by pr.id, pr.name, o.name) x), '[]'::jsonb),
    'quiet', coalesce((
      select jsonb_agg(jsonb_build_object('program_id', x.id, 'program', x.name, 'org', x.org, 'last_active', x.last_active) order by x.last_active nulls first)
        from (select pr.id, pr.name, o.name as org,
                     (select max(p.last_seen_at) from public.program_members m join public.profiles p on p.id = m.user_id
                       where m.program_id = pr.id and m.status = 'active' and not coalesce(m.is_test, false)
                         and not public.is_platform_admin(m.user_id)) as last_active
                from public.programs pr join public.organizations o on o.id = pr.organization_id
               where coalesce(pr.is_active, true) and o.kind <> 'library') x
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

create or replace function public.post_announcement_everywhere(p_message text, p_pinned boolean default false)
returns integer language sql security definer set search_path = public as $function$
  select public.post_announcement_to(
    array(select pr.id from public.programs pr join public.organizations o on o.id = pr.organization_id
           where coalesce(pr.is_active, true) and o.kind <> 'library'),
    p_message, p_pinned)
$function$;

-- ── 8. Who can call what ────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._lib_table(text)', 'public._lib_clone(regclass, uuid, jsonb)', 'public._lib_strip(jsonb, text[])',
    'public._lib_map_get(uuid, regclass, uuid)', 'public._lib_map_put(uuid, regclass, uuid, uuid)',
    'public._lib_ensure_cat(regclass, uuid, text, uuid)', 'public._lib_owner(uuid)',
    'public._lib_copy_play(uuid, uuid, uuid)', 'public._lib_copy_workout(uuid, uuid, uuid)',
    'public._lib_copy_team_drill(uuid, uuid, uuid)', 'public._lib_copy_template(uuid, uuid, uuid)',
    'public._lib_bank(uuid, uuid, uuid)', 'public._lib_copy_lifting(uuid, uuid, uuid)',
    'public._lib_copy(text, uuid, uuid, uuid)', 'public._lib_title(text, uuid)', 'public._lib_meta(text, uuid)',
    'public._lib_apply_starter(uuid, uuid)', 'public._lib_starter_trg()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

grant execute on function public.library_program_id() to authenticated;
grant execute on function public.library_add(text, uuid) to authenticated;
grant execute on function public.library_in_library(uuid[]) to authenticated;
grant execute on function public.library_browse(uuid, text) to authenticated;
grant execute on function public.platform_library() to authenticated;
grant execute on function public.library_set(uuid, boolean, boolean) to authenticated;
grant execute on function public.library_remove(uuid) to authenticated;
grant execute on function public.library_new(text[]) to authenticated;
grant execute on function public.library_pick(uuid, boolean) to authenticated;
revoke execute on function public.library_add(text, uuid), public.library_in_library(uuid[]), public.library_browse(uuid, text),
  public.platform_library(), public.library_set(uuid, boolean, boolean), public.library_remove(uuid),
  public.library_new(text[]), public.library_pick(uuid, boolean) from anon;

-- ── 9. Self-check ───────────────────────────────────────────────
do $$
declare
  v_lib  uuid := public.library_program_id();
  v_diff int;
begin
  if v_lib is null then raise exception 'Self-check: the Shared Library program wasn''t created.'; end if;
  if exists (select 1 from public.program_members where program_id = v_lib) then
    raise exception 'Self-check: the Shared Library program should have no members.';
  end if;
  if (select join_code from public.programs where id = v_lib) is not null then
    raise exception 'Self-check: the Shared Library program must not have a team code.';
  end if;

  select count(*) into v_diff
    from _lib_before b
    join lateral (
      select (select count(*) from public.workouts w where w.program_id = b.program_id) as workouts,
             (select count(*) from public.plays p where p.program_id = b.program_id) as plays,
             (select count(*) from public.practice_drills_library d where d.program_id = b.program_id) as team_drills,
             (select count(*) from public.practices x where x.program_id = b.program_id) as practices,
             (select count(*) from public.lifting_programs l where l.program_id = b.program_id) as lifting,
             (select count(*) from public.program_members m where m.program_id = b.program_id) as members) a on true
   where (a.workouts, a.plays, a.team_drills, a.practices, a.lifting, a.members)
         is distinct from (b.workouts, b.plays, b.team_drills, b.practices, b.lifting, b.members);
  if v_diff > 0 then
    raise exception 'Self-check: % program(s) changed. Rolled back.', v_diff;
  end if;
end $$;

commit;

select 'yes' as shared_library_ready,
       (select name from public.programs where id = public.library_program_id()) as hidden_program,
       (select count(*) from public.library_starter_done) as programs_past_starter_pack;
