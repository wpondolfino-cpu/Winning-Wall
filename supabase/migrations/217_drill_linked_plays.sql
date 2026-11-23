-- ============================================================
-- 217_drill_linked_plays.sql
--
-- A play linked to a drill ("Intro to Blob 1" -> Blob 1) can be watched
-- wherever the drill is: on the drill card (every coach on staff), in a
-- published practice (players), and on the printout.
--
-- Plays stay private as before — this doesn't open the Plays tab or any
-- playbook. It only hands back the one play a drill is linked to, read-only,
-- and only to people in that drill's program. Editing is still the play's
-- owner's alone.
--
-- Safe to run more than once.
-- ============================================================

create or replace function public.drill_linked_plays(p_drills uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- { "<drill id>": { ...the play... }, ... }
  select coalesce(jsonb_object_agg(d.id, to_jsonb(p)), '{}'::jsonb)
    from public.practice_drills_library d
    join public.plays p on p.id = d.linked_play_id
   where d.id = any(p_drills)
     and p.kind = 'play'
     and public.is_program_member(d.program_id, auth.uid());
$$;

revoke all on function public.drill_linked_plays(uuid[]) from public, anon;
grant execute on function public.drill_linked_plays(uuid[]) to authenticated;
