-- 109_missed_fg_by_type.sql
--
-- Fixes inflated shooting percentages.
--
-- A trip records ONE outcome -- its last one. So "miss a 2, offensive
-- rebound, make a 2" commits as a single fg_made row and counts as one
-- attempt and one make: 100%. It was two attempts and one make.
--
-- missed_fg_count already tallies those rebounded misses, but it's only
-- ever been read to build the OREB% denominator, never the shooting one,
-- and it doesn't record whether the miss was a 2 or a 3 -- so it can't be
-- attributed even if it were read. That's why eFG%, 2PT%, 3PT% and FT
-- rate have all been running high by roughly the offensive rebound rate.
--
-- Splitting the counter by shot type costs NO new taps. The tracker
-- already knows: make/miss and 2/3 are both tapped before it ever asks
-- about the rebound, and the pending commit is still holding the shot
-- type when the counter increments. It was simply being discarded.
--
-- missed_fg_count is kept as-is rather than dropped. It's the total, it
-- still feeds OREB% unchanged, and keeping it means this migration can't
-- break a stat that was already correct.
--
-- No backfill: rows tracked before this have the total but no split, so
-- their shooting percentages stay as they were rather than being
-- half-corrected into something harder to reason about.

alter table public.possessions
  add column if not exists missed_fg2_count int not null default 0;

alter table public.possessions
  add column if not exists missed_fg3_count int not null default 0;
