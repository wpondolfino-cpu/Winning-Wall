-- 024_fix_leaderboard_view.sql
DROP VIEW IF EXISTS public.leaderboard;

CREATE VIEW public.leaderboard AS
  SELECT
    p.id,
    p.name,
    p.position,
    p.jersey,
    p.avatar_url,
    p.grade_category,
    p.is_period_champion,
    p.champion_since,
    COALESCE(SUM(s.points), 0) + COALESCE(b.bonus_total, 0) AS total_points,
    COALESCE(SUM(s.made), 0)       AS total_made,
    COALESCE(SUM(s.attempts), 0)   AS total_attempts,
    COALESCE(MIN(s.sprint_secs) FILTER (WHERE s.sprint_secs > 0), 0) AS best_sprint,
    COUNT(DISTINCT s.workout_id)   AS workouts_completed,
    MAX(s.logged_at)               AS last_logged_at,
    RANK() OVER (ORDER BY COALESCE(SUM(s.points), 0) + COALESCE(b.bonus_total, 0) DESC) AS rank
  FROM public.profiles p
  LEFT JOIN public.scores s ON s.player_id = p.id
  LEFT JOIN (
    SELECT player_id, SUM(points) AS bonus_total
    FROM public.streak_bonuses
    GROUP BY player_id
  ) b ON b.player_id = p.id
  WHERE p.role = 'player'
  GROUP BY p.id, p.name, p.position, p.jersey, p.avatar_url,
           p.grade_category, p.is_period_champion, p.champion_since,
           b.bonus_total;
