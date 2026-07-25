-- 082_clear_legacy_saved_actions.sql
-- The saved_actions.data column just changed shape entirely — it used
-- to store a full frame snapshot (specific players + their positions),
-- now it stores a role-based relative motion with no players baked in
-- (see plays.ts: SavedActionData / buildSavedActionData / applySavedAction).
--
-- There's no meaningful way to auto-convert an old snapshot into the
-- new role-based shape, and trying to apply an old-shaped row through
-- the new code would error out. This clears every existing saved
-- action so the table starts clean under the new format — anything
-- you already saved will need to be re-drawn and re-saved once, but
-- going forward it'll actually work the way you want (reusable by any
-- players, not tied to the original jersey numbers).
--
-- Safe to run once. Only run this if you already have rows in
-- saved_actions from before this change — if the table's already
-- empty, this does nothing.

delete from public.saved_actions;
