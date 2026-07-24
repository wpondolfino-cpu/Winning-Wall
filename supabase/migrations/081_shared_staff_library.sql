-- 081_shared_staff_library.sql
-- Two changes, both coach/admin-facing:
--
-- 1. Saved actions (the reusable "Flare screen"-style stamps) become
--    shared across the whole coaching staff when created by a coach
--    or admin — any staff member can see and use them, but only an
--    admin can edit or delete one. Saved actions created by a PLAYER
--    stay exactly as they were: private to that player, fully theirs
--    to manage. Nothing changes about how players use this feature.
--
-- 2. Formations — a new, offense/defense-only starting-position
--    library (e.g. "Horns", "2-3 zone"). Positions only, no motion.
--    Every formation is staff-created and staff-shared by definition
--    (no personal formations); any coach/admin can add one, only an
--    admin can delete one.

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = uid and role = 'admin'
  );
$$;

-- ── Saved actions: replace the old "owner does everything" policy
--    with role-aware read/insert/update/delete ─────────────────────
drop policy if exists "saved_actions_owner_all" on public.saved_actions;

drop policy if exists "saved_actions_read" on public.saved_actions;
create policy "saved_actions_read" on public.saved_actions
  for select using (
    auth.uid() = created_by
    or (public.is_staff(created_by) and public.is_staff(auth.uid()))
  );

drop policy if exists "saved_actions_insert" on public.saved_actions;
create policy "saved_actions_insert" on public.saved_actions
  for insert with check (auth.uid() = created_by);

drop policy if exists "saved_actions_update" on public.saved_actions;
create policy "saved_actions_update" on public.saved_actions
  for update using (
    (auth.uid() = created_by and not public.is_staff(created_by))
    or (public.is_staff(created_by) and public.is_admin(auth.uid()))
  );

drop policy if exists "saved_actions_delete" on public.saved_actions;
create policy "saved_actions_delete" on public.saved_actions
  for delete using (
    (auth.uid() = created_by and not public.is_staff(created_by))
    or (public.is_staff(created_by) and public.is_admin(auth.uid()))
  );

-- ── Formations ───────────────────────────────────────────────────
create table if not exists public.formations (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  side       text not null check (side in ('offense', 'defense')),
  -- { players: PlayPlayer[] } for an offense formation, or
  -- { defenders: PlayDefender[] } for a defense formation.
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.formations enable row level security;

drop policy if exists "formations_read" on public.formations;
create policy "formations_read" on public.formations
  for select using (public.is_staff(auth.uid()));

drop policy if exists "formations_insert" on public.formations;
create policy "formations_insert" on public.formations
  for insert with check (public.is_staff(auth.uid()) and auth.uid() = created_by);

drop policy if exists "formations_update" on public.formations;
create policy "formations_update" on public.formations
  for update using (public.is_staff(auth.uid()));

drop policy if exists "formations_delete" on public.formations;
create policy "formations_delete" on public.formations
  for delete using (public.is_admin(auth.uid()));
