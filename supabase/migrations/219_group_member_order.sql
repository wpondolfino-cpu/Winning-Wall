-- ============================================================
-- 219_group_member_order.sql
--
-- Coaches can drag players up and down inside a group (practice groups
-- without teams). The order they set is kept here and used on screen, on
-- the printout and in the players' view.
--
-- Teams inside a group already keep their own order, so they need nothing
-- here. Rows with no position yet (everything before this, and anyone
-- just moved in) come after the ordered ones, as before.
--
-- Safe to run more than once.
-- ============================================================

alter table public.segment_drill_group_members
  add column if not exists position int;
