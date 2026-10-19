-- 197_head_coach_view_plays.sql
-- Head coaches can VIEW every play their program's coaches have drawn.
--
-- Before: plays were visible only to the coach who drew them, plus anyone
-- they shared with (directly or through a published playbook).
-- After: a program's head coaches (and the platform admin) can also read
-- plays drawn by that program's coaches -- view only. Editing, deleting
-- and sharing stay with the coach who drew the play (plays_owner_all).
-- Players' own private plays are NOT included; neither are other
-- programs' plays (program_scope still applies on top).
-- Safe to run again.

begin;

drop policy if exists plays_head_coach_read on public.plays;
create policy plays_head_coach_read on public.plays
  for select to authenticated
  using (
    public.is_program_head_coach(program_id, auth.uid())
    and coalesce(public.program_role(program_id, created_by) in ('head_coach', 'coach'), false)
  );

commit;

select 'yes' as head_coaches_can_view_staff_plays;
