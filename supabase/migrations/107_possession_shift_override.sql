-- 107_possession_shift_override.sql
-- The free-throw substitution case, and anything else the derived rule
-- gets wrong.
--
-- Shift membership is normally DERIVED: a possession belongs to the latest
-- shift starting at or before it. That rule is right almost always and
-- keeps possessions free of shift bookkeeping, which is what let the live
-- tracker stay untouched by the whole lineup feature.
--
-- It has one known wrong answer. A player is fouled, a substitution happens
-- between the two free throws, and the second shot belongs to the five that
-- earned it -- not the five that came on. Building that into the derivation
-- would mean a decision branch in the middle of a live flow, for something
-- that happens once or twice a game.
--
-- So: an override. Null for essentially every possession, and where it's
-- set it simply wins. Cheaper than complicating the rule, and visible in
-- the entry screen rather than hidden in a formula.

alter table public.possessions
  add column if not exists shift_override_id uuid references public.shifts(id) on delete set null;

create index if not exists possessions_shift_override_idx
  on public.possessions(shift_override_id)
  where shift_override_id is not null;
