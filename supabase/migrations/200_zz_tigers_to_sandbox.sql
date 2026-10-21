-- 200_zz_tigers_to_sandbox.sql
-- Moves the "ZZ Tigers" test material out of AHS Boys into the sandbox,
-- and keeps it there for good (Reset skips it).
--
-- Moved:    the ZZ Tigers opponent, its game(s), scout sheet(s) with their
--           roster / sets / specials / defense, and the quizzes made from
--           them (questions, answer choices, answer keys).
-- Copied:   any Boys plays the scout sheet or quizzes link to -- the sandbox
--           gets its own copies; Boys keeps its plays untouched.
-- Removed:  test activity tied to Boys players, which can't come along:
--           quiz attempts and answers, review-deck items, live quiz runs,
--           re-teach items on practices, per-player question assignments,
--           and any tracked stats / shifts / call-ups / rotation plan for
--           the ZZ Tigers game.
-- Re-pointed in the sandbox: the game's team -> sandbox Varsity, its season
--           -> the sandbox season; week and play sheet are cleared; scout
--           player "who guards him" assignments are cleared.
--
-- Run 198 first. Safe to run again (the second run finds nothing to move).

begin;

-- ── 1. What Reset must never wipe ───────────────────────────────
create table if not exists public.sandbox_keep (
  table_name text not null,
  key_column text not null default 'id',
  row_id     uuid not null,
  added_at   timestamptz not null default now(),
  primary key (table_name, row_id)
);
alter table public.sandbox_keep enable row level security;   -- no policies: functions only
revoke all on public.sandbox_keep from anon, authenticated;

-- ── 2. The move ─────────────────────────────────────────────────
do $$
declare
  v_boys  uuid := public.legacy_default_program_id();
  v_sb    uuid := public.sandbox_program_id();
  v_owner uuid;
  v_var   uuid;
  v_season uuid;
  opp  uuid[]; gms uuid[]; sheets uuid[]; qz uuid[]; qq uuid[]; att uuid[]; ses uuid[];
  pl   uuid[]; p uuid; v_new uuid;
  v_arrtype text := (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                      where a.attrelid = 'public.quizzes'::regclass and a.attname = 'source_play_ids');
  n_games int; n_sheets int; n_quizzes int; n_plays int := 0;
begin
  if v_sb is null then raise exception 'Run 198 (the sandbox) first.'; end if;

  select array_agg(id) into opp from public.opponents
   where program_id = v_boys and name ilike '%zz%tiger%';
  select array_agg(id) into gms from public.games
   where program_id = v_boys and (opponent ilike '%zz%tiger%' or opponent_id = any(coalesce(opp, '{}')));
  select array_agg(id) into sheets from public.scout_sheets
   where program_id = v_boys and (game_id = any(coalesce(gms, '{}')) or opponent_id = any(coalesce(opp, '{}')));
  select array_agg(id) into qz from public.quizzes
   where program_id = v_boys and (title ilike '%zz%tiger%'
         or scout_sheet_id = any(coalesce(sheets, '{}'))
         or game_id = any(coalesce(gms, '{}')) or review_game_id = any(coalesce(gms, '{}')));
  opp := coalesce(opp, '{}'); gms := coalesce(gms, '{}'); sheets := coalesce(sheets, '{}'); qz := coalesce(qz, '{}');
  select coalesce(array_agg(id), '{}') into qq from public.quiz_questions where quiz_id = any(qz);

  if cardinality(opp) + cardinality(gms) + cardinality(sheets) + cardinality(qz) = 0 then
    raise notice 'Nothing named ZZ Tigers left in AHS Boys. Nothing changed.';
    return;
  end if;

  -- Activity that belongs to Boys players: removed, not moved.
  select coalesce(array_agg(id), '{}') into att from public.quiz_attempts where quiz_id = any(qz);
  select coalesce(array_agg(id), '{}') into ses from public.live_sessions where quiz_id = any(qz);
  delete from public.live_answers      where session_id = any(ses) or question_id = any(qq);
  delete from public.live_participants where session_id = any(ses);
  delete from public.live_sessions     where id = any(ses);
  delete from public.quiz_answers      where attempt_id = any(att) or question_id = any(qq);
  delete from public.quiz_attempts     where id = any(att);
  delete from public.quiz_review_items where question_id = any(qq);
  delete from public.practice_cover_items where quiz_question_id = any(qq);
  delete from public.quiz_question_assignees where question_id = any(qq);
  delete from public.possessions    where game_id = any(gms);
  delete from public.shifts         where game_id = any(gms);
  delete from public.lineup_events  where game_id = any(gms);
  delete from public.game_call_ups  where game_id = any(gms);
  delete from public.rotation_plans where game_id = any(gms);

  -- Sandbox targets.
  select m.user_id into v_owner from public.program_members m
   where m.program_id = v_sb and m.role = 'head_coach' and m.status = 'active' order by m.created_at limit 1;
  select id into v_var from public.rosters where program_id = v_sb and name = 'Varsity' limit 1;
  select id into v_season from public.seasons where program_id = v_sb and is_current limit 1;

  -- Plays the scout sheet / quizzes point at: the sandbox gets copies.
  -- (text on the way through: source_play_ids may be stored as text[] or uuid[])
  select coalesce(array_agg(distinct pp.id), '{}') into pl from (
    select play_id::text as x from public.scout_offense_sets where scout_sheet_id = any(sheets) and play_id is not null
    union select play_id::text from public.scout_specials where scout_sheet_id = any(sheets) and play_id is not null
    union select unnest(source_play_ids)::text from public.quizzes where id = any(qz)) s
   join public.plays pp on pp.id::text = s.x and pp.program_id = v_boys;
  foreach p in array pl loop
    v_new := public._lib_copy_play(p, v_sb, coalesce((select created_by from public.plays where id = p), v_owner));
    if v_new is null then continue; end if;
    n_plays := n_plays + 1;
    insert into public.sandbox_keep (table_name, row_id) values ('plays', v_new) on conflict do nothing;
    update public.scout_offense_sets set play_id = v_new where scout_sheet_id = any(sheets) and play_id = p;
    update public.scout_specials     set play_id = v_new where scout_sheet_id = any(sheets) and play_id = p;
    execute format('update public.quizzes set source_play_ids = replace(source_play_ids::text, %L, %L)::%s where id = any($1)',
                   p::text, v_new::text, v_arrtype) using qz;
    update public.quiz_questions
       set visual = replace(visual::text, p::text, v_new::text)::jsonb,
           reveal = case when reveal is null then null else replace(reveal::text, p::text, v_new::text)::jsonb end
     where id = any(qq);
  end loop;

  -- Move.
  update public.opponents set program_id = v_sb where id = any(opp);
  update public.games set program_id = v_sb, roster_id = v_var, season_id = coalesce(v_season, season_id),
         week_id = null, gameday_sheet_id = null
   where id = any(gms);
  update public.scout_sheets       set program_id = v_sb where id = any(sheets);
  update public.scout_players      set program_id = v_sb, assigned_to_profile_id = null where scout_sheet_id = any(sheets);
  update public.scout_offense_sets set program_id = v_sb where scout_sheet_id = any(sheets);
  update public.scout_specials     set program_id = v_sb where scout_sheet_id = any(sheets);
  update public.scout_defense      set program_id = v_sb where scout_sheet_id = any(sheets);
  update public.quizzes set program_id = v_sb,
         roster_ids = case when v_var is null then '{}' else array[v_var] end,
         playbook_id = null,
         replaces_quiz_id = case when replaces_quiz_id = any(qz) then replaces_quiz_id else null end
   where id = any(qz);
  update public.quiz_questions        set program_id = v_sb where id = any(qq);
  update public.quiz_question_options set program_id = v_sb where question_id = any(qq);
  update public.quiz_answer_keys      set program_id = v_sb where question_id = any(qq);

  -- Keep them through every Reset.
  insert into public.sandbox_keep (table_name, row_id)
  select 'opponents', unnest(opp) union all
  select 'games', unnest(gms) union all
  select 'scout_sheets', unnest(sheets) union all
  select 'scout_players', id from public.scout_players where scout_sheet_id = any(sheets) union all
  select 'scout_offense_sets', id from public.scout_offense_sets where scout_sheet_id = any(sheets) union all
  select 'scout_specials', id from public.scout_specials where scout_sheet_id = any(sheets) union all
  select 'scout_defense', id from public.scout_defense where scout_sheet_id = any(sheets) union all
  select 'quizzes', unnest(qz) union all
  select 'quiz_questions', unnest(qq) union all
  select 'quiz_question_options', id from public.quiz_question_options where question_id = any(qq)
  on conflict do nothing;
  insert into public.sandbox_keep (table_name, key_column, row_id)
  select 'quiz_answer_keys', 'question_id', question_id from public.quiz_answer_keys where question_id = any(qq)
  on conflict do nothing;

  n_games := cardinality(gms); n_sheets := cardinality(sheets); n_quizzes := cardinality(qz);
  perform public._plog('Moved ZZ Tigers to the sandbox', null, v_sb,
    n_games || ' game(s), ' || n_sheets || ' scout sheet(s), ' || n_quizzes || ' quiz(zes), ' || n_plays || ' play cop(ies)');
end $$;

-- ── 3. Reset skips anything on the keep list ────────────────────
create or replace function public._sandbox_has_rows(p_table text, p_pid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r boolean; v_key text;
begin
  select key_column into v_key from public.sandbox_keep where table_name = p_table limit 1;
  if v_key is null then
    execute format('select exists (select 1 from public.%I where program_id = $1)', p_table) into r using p_pid;
  else
    execute format('select exists (select 1 from public.%I x where x.program_id = $1
                     and not exists (select 1 from public.sandbox_keep k where k.table_name = %L and k.row_id = x.%I))',
                   p_table, p_table, v_key) into r using p_pid;
  end if;
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
  v_key   text;
  t       text;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;
  if v_pid is null then raise exception 'There''s no sandbox program.'; end if;
  if not exists (select 1 from public.programs pr join public.organizations o on o.id = pr.organization_id
                  where pr.id = v_pid and o.kind = 'sandbox' and pr.join_code is null) then
    raise exception 'Refusing to reset: that program isn''t the sandbox.';
  end if;

  select coalesce(array_agg(c.table_name::text order by c.table_name), '{}') into v_all
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'program_id' and tb.table_type = 'BASE TABLE'
     and c.table_name <> all (v_keep);

  for v_round in 1..4 loop
    v_left := v_all;
    for v_pass in 1..30 loop
      v_next := '{}';
      foreach t in array v_left loop
        begin
          v_key := null;
          select key_column into v_key from public.sandbox_keep where table_name = t limit 1;
          if v_key is null then
            execute format('delete from public.%I where program_id = $1', t) using v_pid;
          else
            execute format('delete from public.%I x where x.program_id = $1
                             and not exists (select 1 from public.sandbox_keep k where k.table_name = %L and k.row_id = x.%I)',
                           t, t, v_key) using v_pid;
          end if;
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

  delete from public.library_copies where target_program = v_pid;

  update public.profiles p
     set total_xp = 0, team_wins = 0, is_period_champion = false, champion_since = null, team_id = null
   where exists (select 1 from public.program_members m where m.program_id = v_pid and m.user_id = p.id)
     and not public.is_platform_admin(p.id)
     and not exists (select 1 from public.program_members o where o.user_id = p.id and o.program_id <> v_pid);

  select m.user_id into v_owner from public.program_members m
   where m.program_id = v_pid and m.role = 'head_coach' and m.status = 'active'
   order by m.created_at limit 1;
  v_added := public._lib_apply_starter(v_pid, coalesce(v_owner, auth.uid()));

  perform public._plog('Sandbox reset', null, v_pid, v_total || ' rows cleared');
  return jsonb_build_object('cleared', v_total, 'starter_items', v_added,
                            'kept', (select count(*) from public.sandbox_keep));
end $$;

revoke all on function public._sandbox_has_rows(text, uuid) from public, anon, authenticated;

-- ── 4. Self-check ───────────────────────────────────────────────
do $$
declare v_boys uuid := public.legacy_default_program_id();
begin
  if exists (select 1 from public.opponents where program_id = v_boys and name ilike '%zz%tiger%')
     or exists (select 1 from public.games where program_id = v_boys and opponent ilike '%zz%tiger%')
     or exists (select 1 from public.quizzes where program_id = v_boys and title ilike '%zz%tiger%') then
    raise exception 'Self-check: some ZZ Tigers material is still in AHS Boys. Rolled back.';
  end if;
end $$;

commit;

select (select count(*) from public.games g where g.program_id = public.sandbox_program_id()
          and exists (select 1 from public.sandbox_keep k where k.table_name = 'games' and k.row_id = g.id)) as games_in_sandbox,
       (select count(*) from public.quizzes q where q.program_id = public.sandbox_program_id()
          and exists (select 1 from public.sandbox_keep k where k.table_name = 'quizzes' and k.row_id = q.id)) as quizzes_in_sandbox,
       (select count(*) from public.sandbox_keep) as kept_through_resets;
