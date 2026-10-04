-- 169_quiz_game_review.sql
--
-- Game-review quizzes: questions built from a game's end-of-game report
-- (team stats only -- never individual or lineup stats): goal checks,
-- where the game was won or lost, which sets worked, scoring runs, and
-- number ranges for stats with goals.
--
--   quizzes.review_game_id -- the game a review quiz was built from.
--
-- my_quizzes is identical to its 163 version apart from reporting
-- kind 'review'. No other changes: review questions are ordinary
-- multiple choice, graded the same way.
--
-- Additive. Run after 161-168.

alter table public.quizzes add column if not exists review_game_id uuid references public.games(id) on delete cascade;
create index if not exists quizzes_review_game_idx on public.quizzes(review_game_id);

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
        'kind', case when z.scout_sheet_id is not null then 'scout'
                     when z.review_game_id is not null then 'review'
                     when z.playbook_id is not null or cardinality(z.source_play_ids) > 0 then 'plays'
                     else 'standalone' end,
        'playbook_id', z.playbook_id,
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
