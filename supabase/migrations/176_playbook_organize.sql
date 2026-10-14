-- 176_playbook_organize.sql
-- Playbooks: sections and hidden plays.
--
--   section  Optional heading a play sits under inside one playbook
--            ("Sets", "BLOB", "2026"). Plain text on the join row, so the
--            same play can sit under different headings in different
--            playbooks. Null = no heading.
--   hidden   Coaches still see the play (faded); players don't get it at
--            all. Lets a playbook be built ahead and plays revealed as
--            they're installed.
--
-- Order already exists (sort_order); it just had no UI.
--
-- Hiding is enforced in the database, not only on screen, with a
-- RESTRICTIVE policy: restrictive policies are AND-ed with whatever
-- permissive ones exist, so this keeps working when the read policies are
-- rewritten for multi-tenancy. plays_playbook_read looks a play up through
-- playbook_plays, so a hidden play also stops being readable through that
-- playbook -- it doesn't leak via the plays table. (A play shared directly
-- with a player through play_shares is a separate share and stays visible.)
--
-- Staff are exempt so coaches can see and manage hidden plays.
-- Multi-tenancy: the staff test uses the shared is_staff() helper (173),
-- not a hand-written profiles.role lookup, so it converts along with
-- every other policy.
--
-- The new columns don't need program_id handling: playbook_plays already
-- has program_id and its labelling trigger (175).

alter table public.playbook_plays
  add column if not exists hidden boolean not null default false,
  add column if not exists section text;

alter table public.playbook_plays
  drop constraint if exists playbook_plays_section_len;
alter table public.playbook_plays
  add constraint playbook_plays_section_len check (section is null or char_length(section) between 1 and 60);

drop policy if exists "playbook_plays_hide_hidden" on public.playbook_plays;
create policy "playbook_plays_hide_hidden" on public.playbook_plays
  as restrictive
  for select using (
    not hidden
    or public.is_staff(auth.uid())
  );
