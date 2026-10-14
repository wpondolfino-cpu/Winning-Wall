-- ============================================================
-- 173_role_helpers.sql
--
-- PREP FOR MULTI-TENANCY — NO BEHAVIOUR CHANGE.
--
-- 66 live security policies checked roles by querying profiles
-- directly ("EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND
-- role IN ('coach','admin'))") instead of the shared helpers
-- is_staff() / is_admin() that the other 66 already use. This file
-- rewrites every one of them to call a helper, so that during the
-- multi-tenancy pass "who counts as staff" changes in a few functions
-- rather than in 130+ places.
--
-- Generated from the LIVE policy definitions (2026-10-13 snapshot), not
-- from the migration files, so each policy keeps exactly what it does
-- today: same name, same command, same table, same target role, same
-- non-role conditions. Only the role lookup is swapped:
--
--   role in ('coach','admin')            ->  public.is_staff(auth.uid())
--   role = 'admin'                       ->  public.is_admin(auth.uid())
--   role in ('coach','admin','player')   ->  public.is_active_user(auth.uid())  (new)
--
-- One merge: workouts had two INSERT policies, one coach-only and one
-- admin-only. Together they meant "coach or admin", so they become a
-- single workouts_staff_insert. Same result, one fewer policy (231 -> 230).
--
-- Left as-is on purpose: the four profiles policies still test the
-- TARGET row's role ("this row is a pending player") — that's data, not
-- who-is-asking, and it moves to program_members in the tenancy pass.
--
-- Everything runs in one transaction: if any statement fails, nothing
-- changes.
-- ============================================================

begin;

-- ── New helper: any approved account (player, coach or admin) ──
create or replace function public.is_active_user(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role in ('player', 'coach', 'admin')
  );
$$;
revoke all on function public.is_active_user(uuid) from public, anon;
grant execute on function public.is_active_user(uuid) to authenticated;

-- ── Safety check: every policy below is recreated as PERMISSIVE (the
-- default). If any of them is currently RESTRICTIVE, stop.
do $$
declare bad text;
begin
  select string_agg(p.tablename || '.' || p.policyname, ', ') into bad
  from pg_policies p
  join (values
    ('public', 'announcements', 'announcements_admin_delete'),
    ('public', 'announcements', 'announcements_coach_insert'),
    ('public', 'announcements', 'announcements_coach_update'),
    ('public', 'app_settings', 'app_settings_admin_write'),
    ('public', 'biweekly_champions', 'hof_admin_delete'),
    ('public', 'biweekly_champions', 'hof_admin_insert'),
    ('public', 'block_rotation_groups', 'block_rotation_groups_staff_all'),
    ('public', 'challenges', 'staff_read_all_challenges'),
    ('public', 'class_clash_competitions', 'Coaches can manage class clash'),
    ('public', 'drill_categories', 'categories_staff_delete'),
    ('public', 'drill_categories', 'categories_staff_insert'),
    ('public', 'drill_categories', 'categories_staff_update'),
    ('public', 'game_call_ups', 'game_call_ups_coach_all'),
    ('public', 'gameday_calls', 'gameday_calls_staff_all'),
    ('public', 'gameday_sections', 'gameday_sections_staff_all'),
    ('public', 'gameday_sheets', 'gameday_sheets_staff_all'),
    ('public', 'games', 'games_staff_all'),
    ('public', 'inseason_history', 'ih_admin_all'),
    ('public', 'library_practice_log', 'staff_read_library_practice'),
    ('public', 'lineup_events', 'lineup_events_coach_all'),
    ('public', 'notifications', 'notif_admin_all'),
    ('public', 'opponents', 'opponents_staff_all'),
    ('public', 'password_reset_requests', 'admins_read_reset'),
    ('public', 'password_reset_requests', 'admins_update_reset'),
    ('public', 'period_snapshots', 'Coaches can insert snapshots'),
    ('public', 'period_snapshots', 'Coaches can read snapshots'),
    ('public', 'period_snapshots', 'staff_delete_period_snapshots'),
    ('public', 'play_calls', 'play_calls_staff_all'),
    ('public', 'playbook_plays', 'playbook_plays_staff_manage'),
    ('public', 'playbook_shares', 'playbook_shares_staff_manage'),
    ('public', 'playbooks', 'playbooks_staff_manage'),
    ('public', 'possessions', 'possessions_staff_all'),
    ('public', 'practice_wins', 'practice_wins_staff_write'),
    ('public', 'profiles', 'coaches_approve_pending'),
    ('public', 'profiles', 'coaches_delete_players'),
    ('public', 'profiles', 'coaches_reject_pending'),
    ('public', 'profiles', 'coaches_update_players'),
    ('public', 'records', 'records_admin_write'),
    ('public', 'report_layout', 'report_layout_staff_write'),
    ('public', 'rotation_plans', 'rotation_plans_coach_all'),
    ('public', 'saved_reports', 'saved_reports_staff_all'),
    ('public', 'schedule_events', 'coaches manage events'),
    ('public', 'scout_defense', 'scout_defense_staff_all'),
    ('public', 'scout_offense_sets', 'scout_offense_sets_staff_all'),
    ('public', 'scout_players', 'scout_players_staff_all'),
    ('public', 'scout_sheets', 'scout_sheets_staff_all'),
    ('public', 'scout_specials', 'scout_specials_staff_all'),
    ('public', 'season_history', 'sh_admin_all'),
    ('public', 'shifts', 'shifts_coach_all'),
    ('public', 'spot_personal_bests', 'Players can read own spot PBs'),
    ('public', 'stat_goals', 'stat_goals_staff_all'),
    ('public', 'streak_bonuses', 'staff_read_all_streak_bonuses'),
    ('public', 'team_competitions', 'tc_admin_write'),
    ('public', 'team_plan_lanes', 'coaches manage team_plan_lanes'),
    ('public', 'team_plan_slots', 'coaches manage team_plan_slots'),
    ('public', 'team_plans', 'coaches manage team_plans'),
    ('public', 'team_positions', 'coaches manage team_positions'),
    ('public', 'teams', 'teams_admin_write'),
    ('public', 'tryout_attendance', 'coaches manage tryout attendance'),
    ('public', 'tryout_players', 'coaches manage tryout players'),
    ('public', 'workout_groups', 'Coaches can manage groups'),
    ('public', 'workout_groups', 'Players can read active groups'),
    ('public', 'workouts', 'workouts_admin_delete'),
    ('public', 'workouts', 'workouts_admin_update'),
    ('public', 'xp_settings', 'xp_admin_write'),
    ('storage', 'objects', 'opponent_logos_staff_write'),
    ('public', 'workouts', 'workouts_coach_write'),
    ('public', 'workouts', 'workouts_admin_insert')
  ) as t(sch, tbl, pol)
    on p.schemaname = t.sch and p.tablename = t.tbl and p.policyname = t.pol
  where p.permissive <> 'PERMISSIVE';
  if bad is not null then
    raise exception 'Stopped: these policies are RESTRICTIVE and need hand-editing: %', bad;
  end if;
end $$;


-- ── Rewritten policies ────────────────────────────────────────

drop policy if exists "announcements_admin_delete" on public.announcements;
create policy "announcements_admin_delete" on public.announcements
  for delete
  using ((public.is_admin(auth.uid())));

drop policy if exists "announcements_coach_insert" on public.announcements;
create policy "announcements_coach_insert" on public.announcements
  for insert
  with check ((public.is_staff(auth.uid())));

drop policy if exists "announcements_coach_update" on public.announcements;
create policy "announcements_coach_update" on public.announcements
  for update
  using ((public.is_staff(auth.uid())));

drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write" on public.app_settings
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "hof_admin_delete" on public.biweekly_champions;
create policy "hof_admin_delete" on public.biweekly_champions
  for delete
  using ((public.is_staff(auth.uid())));

drop policy if exists "hof_admin_insert" on public.biweekly_champions;
create policy "hof_admin_insert" on public.biweekly_champions
  for insert
  with check ((public.is_staff(auth.uid())));

drop policy if exists "block_rotation_groups_staff_all" on public.block_rotation_groups;
create policy "block_rotation_groups_staff_all" on public.block_rotation_groups
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "staff_read_all_challenges" on public.challenges;
create policy "staff_read_all_challenges" on public.challenges
  for select
  using ((public.is_staff(auth.uid())));

drop policy if exists "Coaches can manage class clash" on public.class_clash_competitions;
create policy "Coaches can manage class clash" on public.class_clash_competitions
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "categories_staff_delete" on public.drill_categories;
create policy "categories_staff_delete" on public.drill_categories
  for delete
  using ((public.is_staff(auth.uid())));

drop policy if exists "categories_staff_insert" on public.drill_categories;
create policy "categories_staff_insert" on public.drill_categories
  for insert
  with check ((public.is_staff(auth.uid())));

drop policy if exists "categories_staff_update" on public.drill_categories;
create policy "categories_staff_update" on public.drill_categories
  for update
  using ((public.is_staff(auth.uid())));

drop policy if exists "game_call_ups_coach_all" on public.game_call_ups;
create policy "game_call_ups_coach_all" on public.game_call_ups
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "gameday_calls_staff_all" on public.gameday_calls;
create policy "gameday_calls_staff_all" on public.gameday_calls
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "gameday_sections_staff_all" on public.gameday_sections;
create policy "gameday_sections_staff_all" on public.gameday_sections
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "gameday_sheets_staff_all" on public.gameday_sheets;
create policy "gameday_sheets_staff_all" on public.gameday_sheets
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "games_staff_all" on public.games;
create policy "games_staff_all" on public.games
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "ih_admin_all" on public.inseason_history;
create policy "ih_admin_all" on public.inseason_history
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "staff_read_library_practice" on public.library_practice_log;
create policy "staff_read_library_practice" on public.library_practice_log
  for select
  using ((public.is_staff(auth.uid())));

drop policy if exists "lineup_events_coach_all" on public.lineup_events;
create policy "lineup_events_coach_all" on public.lineup_events
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "notif_admin_all" on public.notifications;
create policy "notif_admin_all" on public.notifications
  for all
  using ((public.is_admin(auth.uid())));

drop policy if exists "opponents_staff_all" on public.opponents;
create policy "opponents_staff_all" on public.opponents
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "admins_read_reset" on public.password_reset_requests;
create policy "admins_read_reset" on public.password_reset_requests
  for select
  using ((public.is_admin(auth.uid())));

drop policy if exists "admins_update_reset" on public.password_reset_requests;
create policy "admins_update_reset" on public.password_reset_requests
  for update
  using ((public.is_admin(auth.uid())));

drop policy if exists "Coaches can insert snapshots" on public.period_snapshots;
create policy "Coaches can insert snapshots" on public.period_snapshots
  for insert
  with check ((public.is_staff(auth.uid())));

drop policy if exists "Coaches can read snapshots" on public.period_snapshots;
create policy "Coaches can read snapshots" on public.period_snapshots
  for select
  using ((public.is_active_user(auth.uid())));

drop policy if exists "staff_delete_period_snapshots" on public.period_snapshots;
create policy "staff_delete_period_snapshots" on public.period_snapshots
  for delete
  using ((public.is_staff(auth.uid())));

drop policy if exists "play_calls_staff_all" on public.play_calls;
create policy "play_calls_staff_all" on public.play_calls
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "playbook_plays_staff_manage" on public.playbook_plays;
create policy "playbook_plays_staff_manage" on public.playbook_plays
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "playbook_shares_staff_manage" on public.playbook_shares;
create policy "playbook_shares_staff_manage" on public.playbook_shares
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "playbooks_staff_manage" on public.playbooks;
create policy "playbooks_staff_manage" on public.playbooks
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "possessions_staff_all" on public.possessions;
create policy "possessions_staff_all" on public.possessions
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "practice_wins_staff_write" on public.practice_wins;
create policy "practice_wins_staff_write" on public.practice_wins
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "coaches_approve_pending" on public.profiles;
create policy "coaches_approve_pending" on public.profiles
  for update
  using (((role = ANY (ARRAY['pending_player'::text, 'pending_coach'::text])) AND (public.is_staff(auth.uid()))))
  with check (true);

drop policy if exists "coaches_delete_players" on public.profiles;
create policy "coaches_delete_players" on public.profiles
  for delete
  using (((role = ANY (ARRAY['player'::text, 'inactive'::text])) AND (public.is_staff(auth.uid()))));

drop policy if exists "coaches_reject_pending" on public.profiles;
create policy "coaches_reject_pending" on public.profiles
  for delete
  using (((role = ANY (ARRAY['pending_player'::text, 'pending_coach'::text])) AND (public.is_staff(auth.uid()))));

drop policy if exists "coaches_update_players" on public.profiles;
create policy "coaches_update_players" on public.profiles
  for update
  using (((role = ANY (ARRAY['player'::text, 'inactive'::text])) AND (public.is_staff(auth.uid()))))
  with check (true);

drop policy if exists "records_admin_write" on public.records;
create policy "records_admin_write" on public.records
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "report_layout_staff_write" on public.report_layout;
create policy "report_layout_staff_write" on public.report_layout
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "rotation_plans_coach_all" on public.rotation_plans;
create policy "rotation_plans_coach_all" on public.rotation_plans
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "saved_reports_staff_all" on public.saved_reports;
create policy "saved_reports_staff_all" on public.saved_reports
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "coaches manage events" on public.schedule_events;
create policy "coaches manage events" on public.schedule_events
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "scout_defense_staff_all" on public.scout_defense;
create policy "scout_defense_staff_all" on public.scout_defense
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "scout_offense_sets_staff_all" on public.scout_offense_sets;
create policy "scout_offense_sets_staff_all" on public.scout_offense_sets
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "scout_players_staff_all" on public.scout_players;
create policy "scout_players_staff_all" on public.scout_players
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "scout_sheets_staff_all" on public.scout_sheets;
create policy "scout_sheets_staff_all" on public.scout_sheets
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "scout_specials_staff_all" on public.scout_specials;
create policy "scout_specials_staff_all" on public.scout_specials
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "sh_admin_all" on public.season_history;
create policy "sh_admin_all" on public.season_history
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "shifts_coach_all" on public.shifts;
create policy "shifts_coach_all" on public.shifts
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "Players can read own spot PBs" on public.spot_personal_bests;
create policy "Players can read own spot PBs" on public.spot_personal_bests
  for select
  using (((auth.uid() = player_id) OR (public.is_staff(auth.uid()))));

drop policy if exists "stat_goals_staff_all" on public.stat_goals;
create policy "stat_goals_staff_all" on public.stat_goals
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "staff_read_all_streak_bonuses" on public.streak_bonuses;
create policy "staff_read_all_streak_bonuses" on public.streak_bonuses
  for select
  using ((public.is_staff(auth.uid())));

drop policy if exists "tc_admin_write" on public.team_competitions;
create policy "tc_admin_write" on public.team_competitions
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "coaches manage team_plan_lanes" on public.team_plan_lanes;
create policy "coaches manage team_plan_lanes" on public.team_plan_lanes
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "coaches manage team_plan_slots" on public.team_plan_slots;
create policy "coaches manage team_plan_slots" on public.team_plan_slots
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "coaches manage team_plans" on public.team_plans;
create policy "coaches manage team_plans" on public.team_plans
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "coaches manage team_positions" on public.team_positions;
create policy "coaches manage team_positions" on public.team_positions
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "teams_admin_write" on public.teams;
create policy "teams_admin_write" on public.teams
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "coaches manage tryout attendance" on public.tryout_attendance;
create policy "coaches manage tryout attendance" on public.tryout_attendance
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "coaches manage tryout players" on public.tryout_players;
create policy "coaches manage tryout players" on public.tryout_players
  for all
  using ((public.is_staff(auth.uid())))
  with check ((public.is_staff(auth.uid())));

drop policy if exists "Coaches can manage groups" on public.workout_groups;
create policy "Coaches can manage groups" on public.workout_groups
  for all
  using ((public.is_staff(auth.uid())));

drop policy if exists "Players can read active groups" on public.workout_groups;
create policy "Players can read active groups" on public.workout_groups
  for select
  using (((status = 'active'::text) OR (public.is_staff(auth.uid()))));

drop policy if exists "workouts_admin_delete" on public.workouts;
create policy "workouts_admin_delete" on public.workouts
  for delete
  using ((public.is_admin(auth.uid())));

drop policy if exists "workouts_admin_update" on public.workouts;
create policy "workouts_admin_update" on public.workouts
  for update
  using ((public.is_admin(auth.uid())));

drop policy if exists "xp_admin_write" on public.xp_settings;
create policy "xp_admin_write" on public.xp_settings
  for all
  using ((public.is_admin(auth.uid())));

drop policy if exists "opponent_logos_staff_write" on storage.objects;
create policy "opponent_logos_staff_write" on storage.objects
  for all to authenticated
  using (((bucket_id = 'opponent-logos'::text) AND (public.is_staff(auth.uid()))))
  with check (((bucket_id = 'opponent-logos'::text) AND (public.is_staff(auth.uid()))));

-- ── workouts: two INSERT policies merged into one ─────────────
drop policy if exists "workouts_coach_write" on public.workouts;
drop policy if exists "workouts_admin_insert" on public.workouts;
drop policy if exists "workouts_staff_insert" on public.workouts;
create policy "workouts_staff_insert" on public.workouts
  for insert
  with check (public.is_staff(auth.uid()));

commit;

