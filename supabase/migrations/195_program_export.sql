-- 195_program_export.sql
-- "Download program data" (platform step 5).
--
-- program_export(program) returns one program's data as sheets
-- ({name, columns, rows}) that the app turns into an Excel file.
-- Platform admin only (a backup / hand-over tool; coaches have Print and
-- Export on each page instead). Test accounts are left out. Read-only,
-- apart from one line in the platform change log.
-- Safe to run again: everything is create-or-replace.

begin;

create or replace function public._x_ts(t timestamptz, tz text)
returns text language sql immutable as $$
  select case when t is null then null else to_char(t at time zone tz, 'YYYY-MM-DD HH24:MI') end
$$;

-- Who was at each practice: rostered players, minus marked absences,
-- plus call-ups. Same rule as computeEffectiveAttendees in the app.
create or replace function public._x_attendance(p_program uuid)
returns table (practice_id uuid, practice_date date, player text, status text, reason text)
language sql stable security definer set search_path = public as $$
  select p.id, p.practice_date, pr.name,
         case when o.override_type = 'absent' then case when coalesce(o.excused, false) then 'Absent (excused)' else 'Absent' end
              when o.override_type = 'call_up' then 'Called up'
              else 'Present' end,
         o.reason
    from public.practices p
    join public.program_members m on m.program_id = p.program_id and m.role = 'player'
                                 and m.status = 'active' and not coalesce(m.is_test, false)
    join public.profiles pr on pr.id = m.user_id
    left join lateral (
      select * from public.practice_attendance_overrides o
       where o.practice_id = p.id and o.player_id = m.user_id
       order by (o.override_type = 'absent') desc
       limit 1) o on true
   where p.program_id = p_program
     and not coalesce(p.is_template, false) and not coalesce(p.is_tryout, false)
     and p.status = 'published' and p.practice_date <= current_date
     and (pr.home_roster_id::text = any(coalesce(p.roster_ids::text[], '{}'::text[])) or o.override_type in ('absent', 'call_up'))
$$;

create or replace function public.program_export(p_program uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pid    uuid := coalesce(p_program, public.current_program_id());
  v_uid    uuid := auth.uid();
  v_tz     text;
  v_prog   text;
  v_org    text;
  v_test   uuid[];
  v_drills jsonb;
  sheets   jsonb := '[]'::jsonb;
begin
  if v_pid is null then raise exception 'Pick a program first.'; end if;
  if not public.is_platform_admin(v_uid) then
    raise exception 'Platform admin only.' using errcode = '42501';
  end if;

  select pr.name, o.name, coalesce(nullif((select value from public.app_settings s
                                            where s.program_id = pr.id and s.key = 'timezone'), ''),
                                   o.timezone, 'America/New_York')
    into v_prog, v_org, v_tz
    from public.programs pr join public.organizations o on o.id = pr.organization_id
   where pr.id = v_pid;
  if v_prog is null then raise exception 'That program doesn''t exist.'; end if;

  v_test := array(select user_id from public.program_members where program_id = v_pid and coalesce(is_test, false));

  -- About
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'About',
    'columns', jsonb_build_array('', ''),
    'rows', jsonb_build_array(
      jsonb_build_array('Program', v_prog),
      jsonb_build_array('School / trainer', v_org),
      jsonb_build_array('Downloaded', public._x_ts(now(), v_tz)),
      jsonb_build_array('Downloaded by', (select name from public.profiles where id = v_uid)),
      jsonb_build_array('Note', 'Test accounts are left out. Times are ' || v_tz || '.'))));

  -- Roster
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Roster',
    'columns', jsonb_build_array('Name', 'Email', 'Role', 'Status', 'Grade', 'Grad year', 'Jersey', 'Position', 'Joined', 'Last seen', 'XP'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(
        p.name, e.email,
        case m.role when 'head_coach' then 'Head coach' when 'coach' then 'Assistant coach' when 'player' then 'Player' else m.role end,
        initcap(m.status), p.grade_category, p.graduation_year, p.jersey, p.position,
        public._x_ts(m.created_at, v_tz), public._x_ts(p.last_seen_at, v_tz), m.total_xp)
        order by case m.role when 'head_coach' then 0 when 'coach' then 1 else 2 end, lower(p.name))
        from public.program_members m
        join public.profiles p on p.id = m.user_id
        left join public.profile_emails e on e.id = p.id
       where m.program_id = v_pid and not coalesce(m.is_test, false)), '[]'::jsonb)));

  -- Leaderboard: points per player, one column per drill that has scores
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title) order by lower(w.title)), '[]'::jsonb)
    into v_drills
    from public.workouts w
   where w.program_id = v_pid
     and exists (select 1 from public.scores s where s.workout_id = w.id and s.program_id = v_pid);
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Leaderboard',
    'columns', jsonb_build_array('Player', 'Grade', 'Total points')
               || coalesce((select jsonb_agg(d->>'title' order by ord) from jsonb_array_elements(v_drills) with ordinality x(d, ord)), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(r.row order by r.total desc, r.name)
        from (
          select p.name,
                 coalesce((select sum(s.points) from public.scores s where s.player_id = m.user_id and s.program_id = v_pid), 0) as total,
                 jsonb_build_array(p.name, p.grade_category,
                   coalesce((select sum(s.points) from public.scores s where s.player_id = m.user_id and s.program_id = v_pid), 0))
                 || coalesce((select jsonb_agg((select sum(s.points) from public.scores s
                                                 where s.player_id = m.user_id and s.workout_id = (d->>'id')::uuid)
                                               order by ord)
                                from jsonb_array_elements(v_drills) with ordinality x(d, ord)), '[]'::jsonb) as row
            from public.program_members m
            join public.profiles p on p.id = m.user_id
           where m.program_id = v_pid and m.role = 'player' and m.status = 'active'
             and not coalesce(m.is_test, false)) r), '[]'::jsonb)));

  -- Drill scores
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Drill scores',
    'columns', jsonb_build_array('Date', 'Player', 'Drill', 'Category', 'Made', 'Attempts', 'Time (sec)', 'Reps', 'Points'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(public._x_ts(s.logged_at, v_tz), p.name, w.title, w.category,
                                         s.made, s.attempts, s.sprint_secs, s.reps, s.points)
                       order by s.logged_at, p.name)
        from public.scores s
        join public.profiles p on p.id = s.player_id
        left join public.workouts w on w.id = s.workout_id
       where s.program_id = v_pid and not (s.player_id = any(v_test))), '[]'::jsonb)));

  -- Player drills
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Player drills',
    'columns', jsonb_build_array('Drill', 'Category', 'Subcategory', 'Tags', 'Scoring', 'Live now', 'Archived', 'Video', 'Added'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(w.title, w.category, w.subcategory, array_to_string(w.tags, ', '), w.scoring_type,
                                         case when w.is_active then 'Yes' else 'No' end,
                                         case when w.library_archived then 'Yes' else 'No' end,
                                         w.video_url, public._x_ts(w.created_at, v_tz))
                       order by lower(coalesce(w.category, '')), lower(w.title))
        from public.workouts w where w.program_id = v_pid), '[]'::jsonb)));

  -- Team drills
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Team drills',
    'columns', jsonb_build_array('Drill', 'Category', 'Minutes', 'Groups', 'Tags', 'Linked play', 'Video'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(d.title, d.category_name, d.default_duration_minutes,
                                         case when d.default_group_size is not null and d.default_num_groups is not null
                                              then d.default_num_groups || ' groups of ' || d.default_group_size end,
                                         (select string_agg(l.tag_name, ', ' order by l.tag_name) from public.practice_drill_tag_links l where l.drill_id = d.id),
                                         (select title from public.plays where id = d.linked_play_id),
                                         d.video_url)
                       order by lower(coalesce(d.category_name, '')), lower(d.title))
        from public.practice_drills_library d where d.program_id = v_pid), '[]'::jsonb)));

  -- Hall of Fame
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Hall of Fame',
    'columns', jsonb_build_array('Record', 'Drill', 'Player', 'Value', 'Season', 'Achieved'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(initcap(replace(r.record_type, '_', ' ')), r.workout_title, r.player_name,
                                         coalesce(r.display_value, r.value::text), r.season, public._x_ts(r.achieved_at, v_tz))
                       order by r.record_type, r.workout_title nulls first)
        from public.records r
       where r.program_id = v_pid and (r.player_id is null or not (r.player_id = any(v_test)))), '[]'::jsonb)));

  -- Practices
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Practices',
    'columns', jsonb_build_array('Date', 'Start', 'Rosters', 'Status', 'Tryout', 'Present', 'Absent'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(p.practice_date, to_char(p.start_time, 'HH12:MI AM'),
                                         (select string_agg(r.name, ', ' order by r.sort_order) from public.rosters r
                                           where r.id::text = any(coalesce(p.roster_ids::text[], '{}'::text[]))),
                                         initcap(p.status), case when p.is_tryout then 'Yes' else 'No' end,
                                         (select count(*) from public._x_attendance(v_pid) a where a.practice_id = p.id and a.status in ('Present', 'Called up')),
                                         (select count(*) from public._x_attendance(v_pid) a where a.practice_id = p.id and a.status like 'Absent%'))
                       order by p.practice_date, p.start_time)
        from public.practices p
       where p.program_id = v_pid and not coalesce(p.is_template, false)), '[]'::jsonb)));

  -- Attendance
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Attendance',
    'columns', jsonb_build_array('Date', 'Player', 'Status', 'Reason'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(a.practice_date, a.player, a.status, a.reason) order by a.practice_date, a.player)
        from public._x_attendance(v_pid) a), '[]'::jsonb)));

  -- Games
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Games',
    'columns', jsonb_build_array('Date', 'Opponent', 'Home/Away', 'Type', 'Us', 'Them', 'Result', 'Status', 'Location', 'Season'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(g.game_date, coalesce(op.name, g.opponent), initcap(g.home_away), g.game_type,
                                         g.final_score_us, g.final_score_them,
                                         case when g.final_score_us is null or g.final_score_them is null then null
                                              when g.final_score_us > g.final_score_them then 'W'
                                              when g.final_score_us < g.final_score_them then 'L' else 'T' end,
                                         initcap(g.status), g.location, g.season)
                       order by g.game_date, g.tip_time)
        from public.games g
        left join public.opponents op on op.id = g.opponent_id
       where g.program_id = v_pid), '[]'::jsonb)));

  -- Lifting logs
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Lifting logs',
    'columns', jsonb_build_array('Date', 'Player', 'Exercise', 'Sets (reps x weight)', 'Top weight', 'Notes'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(public._x_ts(l.logged_at, v_tz), p.name, b.name,
                                         (select string_agg(coalesce(e->>'reps', '?') || ' x ' || coalesce(e->>'weight', '?'), ', ' order by ord)
                                            from jsonb_array_elements(case when jsonb_typeof(l.sets_data) = 'array' then l.sets_data else '[]'::jsonb end)
                                                 with ordinality x(e, ord)),
                                         (select max(nullif(e->>'weight', '')::numeric)
                                            from jsonb_array_elements(case when jsonb_typeof(l.sets_data) = 'array' then l.sets_data else '[]'::jsonb end) e
                                           where (e->>'weight') ~ '^[0-9.]+$'),
                                         l.notes)
                       order by l.logged_at, p.name)
        from public.lifting_logs l
        join public.profiles p on p.id = l.player_id
        left join public.lifting_exercise_bank b on b.id = l.exercise_id
       where l.program_id = v_pid and not (l.player_id = any(v_test))), '[]'::jsonb)));

  -- Lifting programs
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Lifting programs',
    'columns', jsonb_build_array('Program', 'Who sees it', 'Days', 'Start date', 'Archived'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(l.title,
                                         case l.visibility when 'public' then 'Everyone' when 'draft' then 'Draft'
                                                           when 'personal' then 'Personal (' || coalesce((select name from public.profiles where id = l.created_by), '?') || ')'
                                                           else 'Assigned players' end,
                                         (select count(*) from public.lifting_days d where d.lifting_program_id = l.id),
                                         l.start_date, case when l.archived then 'Yes' else 'No' end)
                       order by l.created_at)
        from public.lifting_programs l
       where l.program_id = v_pid and not (coalesce(l.created_by, '00000000-0000-0000-0000-000000000000'::uuid) = any(v_test))), '[]'::jsonb)));

  -- Plays
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Plays',
    'columns', jsonb_build_array('Play', 'Category', 'Tags', 'Drawn by', 'Last changed'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(pl.title, pl.category, array_to_string(pl.tags, ', '),
                                         (select name from public.profiles where id = pl.created_by),
                                         public._x_ts(coalesce(pl.updated_at, pl.created_at), v_tz))
                       order by lower(coalesce(pl.category, '')), lower(pl.title))
        from public.plays pl where pl.program_id = v_pid), '[]'::jsonb)));

  -- Playbooks
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Playbooks',
    'columns', jsonb_build_array('Playbook', 'Status', 'Number of plays', 'Plays'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(pb.name, initcap(pb.status),
                                         (select count(*) from public.playbook_plays pp where pp.playbook_id = pb.id),
                                         (select string_agg(pl.title, ', ' order by pp.sort_order)
                                            from public.playbook_plays pp join public.plays pl on pl.id = pp.play_id
                                           where pp.playbook_id = pb.id))
                       order by lower(pb.name))
        from public.playbooks pb where pb.program_id = v_pid), '[]'::jsonb)));

  -- Announcements
  sheets := sheets || jsonb_build_array(jsonb_build_object('name', 'Announcements',
    'columns', jsonb_build_array('Date', 'From', 'Pinned', 'Message'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(public._x_ts(a.created_at, v_tz), a.coach_name,
                                         case when a.is_pinned then 'Yes' else 'No' end, a.message)
                       order by a.created_at desc)
        from public.announcements a where a.program_id = v_pid), '[]'::jsonb)));

  perform public._plog('Downloaded program data', null, v_pid, null);

  return jsonb_build_object('program', v_prog, 'org', v_org, 'sheets', sheets);
end $$;

revoke all on function public._x_attendance(uuid) from public, anon, authenticated;
revoke all on function public.program_export(uuid) from public, anon;
grant execute on function public.program_export(uuid) to authenticated;

commit;

select 'yes' as export_ready;
