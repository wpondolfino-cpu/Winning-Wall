-- 220_head_coach_invites.sql
-- Head-coach invite links that are safe to open.
--
-- The old "Just give me a link" invite used Supabase's one-time sign-in
-- link: the first click used it up (an email scanner, or you testing it),
-- and whoever clicked was signed in as the new coach. These invites are
-- different: opening the link only SHOWS a welcome page. Nothing happens
-- until the person types their name and a password and taps Create, so you
-- can open it yourself to check it, and a scanner can't use it up.
--
-- Only the invite-coach edge function (server key) reads or writes this
-- table. Row level security is on with no policies, so the app can't see it.

create table if not exists public.head_coach_invites (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  program_id    uuid not null references public.programs(id) on delete cascade,
  email         text not null,
  name          text,
  invited_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  accepted_user uuid references auth.users(id) on delete set null,
  revoked_at    timestamptz
);

create index if not exists head_coach_invites_program_idx on public.head_coach_invites (program_id, created_at desc);

alter table public.head_coach_invites enable row level security;
revoke all on public.head_coach_invites from anon, authenticated;
