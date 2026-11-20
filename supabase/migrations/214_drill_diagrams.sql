-- ============================================================
-- 214_drill_diagrams.sql
--
-- Drill diagrams: a drill in the Drill Library can have its own drawing,
-- made in the play designer.
--
--   plays.kind                              'play' (default) or 'drill'.
--                                           Drill diagrams stay out of the
--                                           Plays list and playbooks.
--   practice_drills_library.diagram_play_id the drill's diagram (separate
--                                           from linked_play_id, which still
--                                           points at a real play).
--
-- Who can do what with a drill diagram:
--   * anyone in the program (coaches and players) can see it, so players
--     see it when they tap the drill in their practice schedule;
--   * any coach in the program can edit or delete it (plays stay
--     owner-only, as before).
-- Deleting a drill deletes its diagram.
--
-- Safe to run more than once. Existing plays are all marked 'play'.
-- ============================================================

-- ── 1. Columns ───────────────────────────────────────────────
alter table public.plays add column if not exists kind text not null default 'play';
alter table public.plays drop constraint if exists plays_kind_check;
alter table public.plays add constraint plays_kind_check check (kind in ('play', 'drill'));
create index if not exists plays_kind_idx on public.plays (program_id, kind);

alter table public.practice_drills_library
  add column if not exists diagram_play_id uuid references public.plays(id) on delete set null;
create index if not exists practice_drills_library_diagram_idx on public.practice_drills_library (diagram_play_id);


-- ── 2. Who can see and change drill diagrams ─────────────────
-- (The program_scope policy on plays still keeps everything inside the
-- program you're in.)
drop policy if exists plays_drill_read on public.plays;
create policy plays_drill_read on public.plays
  for select to authenticated
  using (kind = 'drill' and public.is_program_member(program_id, auth.uid()));

drop policy if exists plays_drill_staff_update on public.plays;
create policy plays_drill_staff_update on public.plays
  for update to authenticated
  using (kind = 'drill' and public.is_program_staff(program_id, auth.uid()))
  with check (kind = 'drill' and public.is_program_staff(program_id, auth.uid()));

drop policy if exists plays_drill_staff_delete on public.plays;
create policy plays_drill_staff_delete on public.plays
  for delete to authenticated
  using (kind = 'drill' and public.is_program_staff(program_id, auth.uid()));


-- ── 3. Deleting a drill deletes its diagram ──────────────────
create or replace function public.delete_drill_diagram()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.diagram_play_id is not null then
    delete from public.plays where id = old.diagram_play_id and kind = 'drill';
  end if;
  return old;
end;
$$;

drop trigger if exists practice_drills_library_delete_diagram on public.practice_drills_library;
create trigger practice_drills_library_delete_diagram
  after delete on public.practice_drills_library
  for each row execute function public.delete_drill_diagram();
