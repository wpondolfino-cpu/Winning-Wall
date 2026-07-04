-- 029_award_team_bonus_fn.sql
-- Creates a security definer function to award team bonus points
-- bypassing RLS so admin can insert streak_bonuses for any player

CREATE OR REPLACE FUNCTION public.award_team_bonus(
  p_player_ids  uuid[],
  p_points      integer,
  p_reason      text DEFAULT 'team_win'
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id uuid;
  v_count integer := 0;
BEGIN
  FOREACH v_player_id IN ARRAY p_player_ids LOOP
    INSERT INTO public.streak_bonuses (player_id, points, streak_length, reason, awarded_at)
    VALUES (v_player_id, p_points, 0, p_reason, now());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_team_bonus(uuid[], integer, text) TO authenticated;

-- Also create a function to increment team_wins on profiles
CREATE OR REPLACE FUNCTION public.increment_team_wins(p_player_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles
  SET team_wins = COALESCE(team_wins, 0) + 1
  WHERE id = ANY(p_player_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_team_wins(uuid[]) TO authenticated;

-- Function to close a team competition (bypasses RLS)
CREATE OR REPLACE FUNCTION public.close_team_competition(
  p_competition_id uuid,
  p_winning_team_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.team_competitions
  SET is_active = false, winning_team_id = p_winning_team_id
  WHERE id = p_competition_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_team_competition(uuid, uuid) TO authenticated;
