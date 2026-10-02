-- 162_quiz_teams.sql
--
-- Quizzes that aren't tied to a scout sheet (a freshman terms quiz, and
-- later play-review quizzes), so a quiz needs its own list of teams.
--
--   quizzes.roster_ids  -- the teams "everyone" means for this quiz.
--                          Scout quizzes fill it from the game's roster;
--                          standalone quizzes have the coach pick.
--   quizzes.due_at      -- optional due date for standalone quizzes.
--                          Scout quizzes keep using the game's tip-off.
--
-- quiz_on_game_roster (from 161) is redefined so every function that
-- uses it -- my_quizzes, start_quiz_attempt, quiz_roster -- follows the
-- quiz's teams with no other changes. my_quizzes also gains due_at and
-- a 'kind' field.
--
-- Additive. Safe to run on top of 161 with quizzes already in it.

alter table public.quizzes add column if not exists roster_ids uuid[] not null default '{}';
alter table public.quizzes add column if not exists due_at timestamptz;

-- Existing scout quizzes: their game's team.
update public.quizzes z
   set roster_ids = array[g.roster_id]
  from public.games g
 where g.id = z.game_id
   and g.roster_id is not null
   and z.roster_ids = '{}';

-- Who "everyone" is for a quiz:
--   1. the quiz's teams, when it has any -- plus anyone called up for its
--      game, so a called-up JV player still gets the varsity scout quiz;
--   2. otherwise its game's roster (as in 161);
--   3. otherwise every player.
create or replace function public.quiz_on_game_roster(p_quiz uuid, p_player uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.quizzes z
    join public.profiles p on p.id = p_player and p.role = 'player'
    left join public.games g on g.id = z.game_id
    where z.id = p_quiz
      and (
        (cardinality(z.roster_ids) > 0 and p.home_roster_id = any(z.roster_ids))
        or (g.id is not null and exists (
              select 1 from public.game_call_ups c where c.game_id = g.id and c.player_id = p_player))
        or (cardinality(z.roster_ids) = 0 and (g.roster_id is null or p.home_roster_id = g.roster_id))
      )
  )
$$;

revoke all on function public.quiz_on_game_roster(uuid, uuid) from public, anon, authenticated;

-- Same as 161, plus 'kind' and 'due_at'.
create or replace function public.my_quizzes()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  return coalesce((
    select jsonb_agg(item order by coalesce(item->>'due_sort', '9999') asc)
    from (
      select jsonb_build_object(
        'quiz_id', z.id,
        'title', z.title,
        'kind', case when z.scout_sheet_id is not null then 'scout' else 'standalone' end,
        'scout_sheet_id', z.scout_sheet_id,
        'game_id', z.game_id,
        'game_date', g.game_date,
        'tip_time', g.tip_time,
        'opponent', g.opponent,
        'due_at', z.due_at,
        'due_sort', coalesce(z.due_at::text, g.game_date::text),
        'feedback_mode', z.feedback_mode,
        'allow_retakes', z.allow_retakes,
        'time_limit_seconds', z.time_limit_seconds,
        'question_count', coalesce(array_length(public.quiz_question_ids_for(z.id, v_uid), 1), 0),
        'attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'attempt_no', a.attempt_no, 'submitted_at', a.submitted_at,
            'correct_count', a.correct_count, 'total_count', a.total_count
          ) order by a.attempt_no)
          from public.quiz_attempts a where a.quiz_id = z.id and a.player_id = v_uid
        ), '[]'::jsonb)
      ) as item
      from public.quizzes z
      left join public.games g on g.id = z.game_id
      where z.status = 'published'
        and coalesce(array_length(public.quiz_question_ids_for(z.id, v_uid), 1), 0) > 0
    ) s
  ), '[]'::jsonb);
end $$;

revoke all on function public.my_quizzes() from public, anon;
grant execute on function public.my_quizzes() to authenticated;
