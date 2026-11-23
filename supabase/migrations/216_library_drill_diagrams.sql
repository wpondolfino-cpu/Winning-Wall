-- ============================================================
-- 216_library_drill_diagrams.sql
--
-- Drill diagrams now travel with their drill.
--
-- Before: copying a team drill (into the Shared Library, or from the
-- library into a program) copied the drill but left its diagram behind —
-- the copy still pointed at the original program's drawing, which nobody
-- outside that program can see. Worse, deleting such a copy deleted the
-- ORIGINAL drawing.
--
--   1. Copies of a team drill get their own copy of its diagram (the same
--      way a linked play is already copied).
--   2. Deleting a drill only deletes its diagram if the diagram is that
--      program's own and no other drill uses it.
--   3. Repairs copies made before this: each drill pointing at another
--      program's diagram gets its own copy, so it shows again.
--
-- Safe to run more than once.
-- ============================================================


-- ── 1. Copies carry their diagram ────────────────────────────
create or replace function public._lib_copy_team_drill(p_src uuid, p_target uuid, p_owner uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.practice_drills_library%rowtype; v uuid; v_play uuid; v_diagram uuid;
begin
  v := public._lib_map_get(p_target, 'public.practice_drills_library', p_src);
  if v is not null then return v; end if;
  select * into r from public.practice_drills_library where id = p_src;
  if not found then return null; end if;
  perform public._lib_ensure_cat('public.practice_drill_categories', p_target, r.category_name, r.program_id);
  if r.linked_play_id is not null then
    v_play := public._lib_copy_play(r.linked_play_id, p_target, p_owner);
  end if;
  -- The drawing is copied too (it stays a drill diagram), so the copy shows
  -- it and can be edited without touching the original.
  if r.diagram_play_id is not null then
    v_diagram := public._lib_copy_play(r.diagram_play_id, p_target, p_owner);
  end if;
  v := public._lib_clone('public.practice_drills_library', p_src, jsonb_build_object(
         'program_id', p_target, 'created_by', p_owner, 'is_starred', false,
         'linked_play_id', v_play, 'diagram_play_id', v_diagram,
         'created_at', now(), 'updated_at', now()));

  insert into public.practice_drill_tags (program_id, name)
  select distinct p_target, l.tag_name from public.practice_drill_tag_links l
   where l.drill_id = p_src
     and not exists (select 1 from public.practice_drill_tags t where t.program_id = p_target and t.name = l.tag_name);
  insert into public.practice_drill_tag_links (drill_id, tag_name, program_id)
  select distinct v, l.tag_name, p_target from public.practice_drill_tag_links l where l.drill_id = p_src;

  perform public._lib_map_put(p_target, 'public.practice_drills_library', p_src, v);
  return v;
end $$;


-- ── 2. Deleting a drill only deletes its own diagram ─────────
create or replace function public.delete_drill_diagram()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.diagram_play_id is not null then
    delete from public.plays p
     where p.id = old.diagram_play_id
       and p.kind = 'drill'
       and p.program_id = old.program_id
       and not exists (select 1 from public.practice_drills_library d
                        where d.diagram_play_id = old.diagram_play_id and d.id <> old.id);
  end if;
  return old;
end;
$$;


-- ── 3. Repair copies made before this ────────────────────────
do $$
declare
  d record;
  v uuid;
  n int := 0;
begin
  for d in
    select dl.id, dl.program_id, dl.created_by, dl.diagram_play_id, p.created_by as drew
      from public.practice_drills_library dl
      join public.plays p on p.id = dl.diagram_play_id
     where p.program_id is distinct from dl.program_id
  loop
    v := public._lib_copy_play(d.diagram_play_id, d.program_id,
                               coalesce(d.created_by, public._lib_owner(d.program_id), d.drew));
    if v is not null then
      update public.practice_drills_library set diagram_play_id = v where id = d.id;
      n := n + 1;
    end if;
  end loop;
  raise notice 'Drill diagrams repaired: %', n;
end $$;
