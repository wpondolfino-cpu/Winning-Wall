-- 130_exact_size_split.sql
--
-- A second way to make groups of N, because the two cases genuinely
-- disagree.
--
-- 'size' leaves nobody out: three players in pairs becomes one group of
-- three, which is right for form shooting — a group of three is better
-- than one player alone at a basket.
--
-- 'size_exact' keeps the groups at exactly N and lets the spare wait:
-- three at a two-person chase drill is a pair and one rotating in,
-- because the drill physically can't take three.
--
-- Which is correct depends on the drill, so it belongs on the station
-- rather than being decided once for everything.

alter table public.segment_drills
  drop constraint if exists segment_drills_split_rule_check;

alter table public.segment_drills
  add constraint segment_drills_split_rule_check
  check (split_rule in ('none', 'teams', 'size', 'size_exact'));
