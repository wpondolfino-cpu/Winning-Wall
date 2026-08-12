-- 106_rotation_plans.sql
-- Phase 5: the rotation you intend to run.
--
-- Per GAME rather than one standing template. A template would imply your
-- rotation is fixed, which it isn't -- it changes by opponent, by who's in
-- foul trouble, by what worked last week. Storing it per game also means
-- plan-versus-actual falls out for free: the plan is already attached to the
-- game whose shifts you'll compare it against.
--
-- Copying forward from the last game gives the convenience of a template
-- without the pretence, so there's no second concept to maintain.
--
-- Blocks are stored as a flat array of five-player sets, in order. Twelve
-- blocks by default -- three per period -- matching the heatmap's grid, so
-- what you did and what you're planning are read on the same axis.

create table if not exists public.rotation_plans (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  -- One plan per game. Editing replaces it rather than accumulating drafts.
  blocks      jsonb not null default '[]'::jsonb,
  -- Minute targets per player, keyed by player id. Advisory only -- going
  -- over shows a warning, never a block.
  minute_targets jsonb not null default '{}'::jsonb,
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint rotation_plans_game_unique unique (game_id)
);

create index if not exists rotation_plans_game_idx on public.rotation_plans(game_id);

alter table public.rotation_plans enable row level security;

drop policy if exists rotation_plans_coach_all on public.rotation_plans;
create policy rotation_plans_coach_all on public.rotation_plans
  for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );
