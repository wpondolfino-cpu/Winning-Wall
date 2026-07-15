-- 067_fix_plays_rls_recursion.sql
-- Fixes "infinite recursion detected in policy for relation plays".
--
-- Cause: plays_shared_read (on plays) queries play_shares to check for an
-- active share; play_shares_owner_manage (on play_shares) queries plays
-- to check ownership. Because both tables have RLS enabled, evaluating
-- one policy re-triggers the other table's policies, which re-triggers
-- the first table's policies, and so on — Postgres detects the cycle and
-- aborts instead of looping forever.
--
-- Fix: move each cross-table check into a SECURITY DEFINER function. A
-- function like this runs with the privileges of the function's owner
-- (not the querying user), so its internal query bypasses RLS entirely
-- instead of re-entering it — breaking the cycle while keeping the exact
-- same access rules.

create or replace function public.is_play_shared_with_me(p_play_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from play_shares
    where play_shares.play_id = p_play_id
      and play_shares.shared_with = auth.uid()
      and play_shares.revoked_at is null
  );
$$;

create or replace function public.owns_play(p_play_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from plays
    where plays.id = p_play_id
      and plays.created_by = auth.uid()
  );
$$;

drop policy if exists "plays_shared_read" on public.plays;
create policy "plays_shared_read" on public.plays
  for select using (public.is_play_shared_with_me(id));

drop policy if exists "play_shares_owner_manage" on public.play_shares;
create policy "play_shares_owner_manage" on public.play_shares
  for all using (public.owns_play(play_id))
  with check (public.owns_play(play_id));
