-- 058_leaderboard_include_bonuses.sql
-- Three fixes to the All-Time leaderboard view — all the same underlying
-- pattern: the view was missing columns that the frontend has been
-- reading from it all along, silently returning undefined instead of an
-- error, so these bugs never surfaced as a crash:
-- 1. total_points only summed public.scores, excluding bonus points
--    (challenge wins, personal bests, streak bonuses).
-- 2. total_xp was never exposed at all — H2HTab.tsx's opponent picker
--    filters candidates using it, so that filter has likely always
--    silently returned zero eligible opponents.
-- 3. grade_category and is_period_champion were never exposed either —
--    breaking the Overall tab's grade-category filter (always empty for
--    any specific grade) and the 👑 champion crown icon (never shows).

create or replace view public.leaderboard as
  select
    p.id,
    p.name,
    p.position,
    p.jersey,
    p.avatar_url,
    p.total_xp,
    p.grade_category,
    p.is_period_champion,
    coalesce(sum(s.points), 0) + coalesce(b.bonus_points, 0) as total_points,
    coalesce(sum(s.made), 0)            as total_made,
    coalesce(sum(s.attempts), 0)        as total_attempts,
    coalesce(min(s.sprint_secs) filter (where s.sprint_secs > 0), 0) as best_sprint,
    count(distinct s.workout_id)        as workouts_completed,
    max(s.logged_at)                    as last_logged_at,
    rank() over (order by coalesce(sum(s.points), 0) + coalesce(b.bonus_points, 0) desc) as rank
  from public.profiles p
  left join public.scores s on s.player_id = p.id
  left join (
    select player_id, sum(points) as bonus_points
    from public.streak_bonuses
    group by player_id
  ) b on b.player_id = p.id
  where p.role = 'player'
  group by p.id, p.name, p.position, p.jersey, p.avatar_url, p.total_xp, p.grade_category, p.is_period_champion, b.bonus_points;
