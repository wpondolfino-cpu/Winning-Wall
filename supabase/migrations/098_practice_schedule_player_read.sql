-- 098_practice_schedule_player_read.sql
-- The player-facing practice schedule view (getPracticePrintData) needs
-- to resolve drill titles and named sub-groups, but practice_drills_
-- library, segment_drill_groups, and segment_drill_group_members were
-- all staff-only -- a player could already read segment_drills itself
-- (074_practice_planner.sql), but not what those rows actually mean.
-- Without this, drill titles/group names would silently come back
-- blank for players even though the schedule "loads".

-- Drill library is just a non-sensitive catalog of drill definitions,
-- same treatment as practice_drill_tags (already fully open).
drop policy if exists "practice_drills_library_read_all" on public.practice_drills_library;
create policy "practice_drills_library_read_all" on public.practice_drills_library
  for select using (true);

-- Groups/members scoped to practices the player actually attends,
-- mirroring segment_drills_player_read's exact join chain.
drop policy if exists "segment_drill_groups_player_read" on public.segment_drill_groups;
create policy "segment_drill_groups_player_read" on public.segment_drill_groups
  for select using (
    exists (
      select 1 from public.segment_drills sd
      join public.block_segments s on s.id = sd.segment_id
      join public.practice_blocks b on b.id = s.block_id
      join public.practices pr on pr.id = b.practice_id
      where sd.id = segment_drill_groups.segment_drill_id
        and pr.status = 'published'
        and public.is_effective_attendee(pr.id, auth.uid())
    )
  );

drop policy if exists "segment_drill_group_members_player_read" on public.segment_drill_group_members;
create policy "segment_drill_group_members_player_read" on public.segment_drill_group_members
  for select using (
    exists (
      select 1 from public.segment_drill_groups g
      join public.segment_drills sd on sd.id = g.segment_drill_id
      join public.block_segments s on s.id = sd.segment_id
      join public.practice_blocks b on b.id = s.block_id
      join public.practices pr on pr.id = b.practice_id
      where g.id = segment_drill_group_members.group_id
        and pr.status = 'published'
        and public.is_effective_attendee(pr.id, auth.uid())
    )
  );
