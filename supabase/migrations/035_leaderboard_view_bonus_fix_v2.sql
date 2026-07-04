-- Leaderboard view with bonus points included in total
-- Run this if leaderboard isn't showing bonus points correctly
DROP VIEW IF EXISTS public.leaderboard;

CREATE VIEW public.leaderboard AS
  SELECT
    p.id,
    p.name,
    p.position,
    p.jersey,
    p.grade_category,
    p.avatar_url,
    p.is_period_champion,
    p.total_xp,
    coalesce(sum(s.points), 0) + coalesce((
      SELECT sum(b.points)
      FROM public.streak_bonuses b
      WHERE b.player_id = p.id
    ), 0)                               AS total_points,
    coalesce(sum(s.made), 0)            AS total_made,
    coalesce(sum(s.attempts), 0)        AS total_attempts,
    coalesce(min(s.sprint_secs) filter (where s.sprint_secs > 0), 0) AS best_sprint,
    count(distinct s.workout_id)        AS workouts_completed,
    max(s.logged_at)                    AS last_logged_at,
    coalesce(
      (SELECT current_streak FROM public.streaks WHERE player_id = p.id),
      0
    )                                   AS current_streak,
    rank() over (order by coalesce(sum(s.points), 0) + coalesce((
      SELECT sum(b.points)
      FROM public.streak_bonuses b
      WHERE b.player_id = p.id
    ), 0) desc)                         AS rank
  FROM public.profiles p
  LEFT JOIN public.scores s ON s.player_id = p.id
  WHERE p.role = 'player'
  GROUP BY p.id, p.name, p.position, p.jersey, p.grade_category,
           p.avatar_url, p.is_period_champion, p.total_xp;
