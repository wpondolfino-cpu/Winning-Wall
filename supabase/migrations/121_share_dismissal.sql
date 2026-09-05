-- 121_share_dismissal.sql
--
-- Lets a recipient set aside something shared with them.
--
-- Before this, anything shared with you stayed in "Shared with me"
-- permanently. Once that list started separating what you'd taken a copy
-- of from what you hadn't, a play you looked at and didn't want sat in
-- the top group looking like an outstanding task forever.
--
-- `viewed_at` was the tempting shortcut — it already exists and is
-- already written when you open a shared play. But viewing isn't
-- declining: you might open something, like it, and mean to take it after
-- practice. Guessing intent from an incidental action is exactly the
-- mistake this avoids, so dismissal is its own explicit field.
--
-- Deliberately NOT revoked_at. That column belongs to the sharer — if a
-- recipient could set it, the coach who sent the play would watch it
-- disappear from their own sent list with no explanation. Dismissal is
-- private to the recipient; the sharer is never told.

alter table public.play_shares
  add column if not exists dismissed_at timestamptz;

alter table public.playbook_shares
  add column if not exists dismissed_at timestamptz;

-- No new policies needed: play_shares_recipient_mark_viewed and
-- playbook_shares_recipient_mark_viewed already grant a recipient UPDATE
-- on their own share rows, which covers this column too.
--
-- Partial indexes so the common read — "what's still in front of me" —
-- doesn't scan rows the recipient has already set aside.
create index if not exists play_shares_active_idx
  on public.play_shares (shared_with)
  where dismissed_at is null and revoked_at is null;

create index if not exists playbook_shares_active_idx
  on public.playbook_shares (shared_with)
  where dismissed_at is null;
