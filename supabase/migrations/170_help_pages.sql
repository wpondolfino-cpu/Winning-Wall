-- 170_help_pages.sql
--
-- The "?" help panel. Every page ships with starter help written into the
-- app (src/lib/help.ts). When an admin edits a page's help in the app, the
-- edit is stored here and shown instead of the starter text; "Reset to
-- starter text" deletes the row.
--
--   page_key  -- which page or screen ("schedule", "playdesigner", ...)
--   audience  -- coach | player: the two get different help
--   intro, steps, and three optional links (hidden in the panel when blank)
--
-- Everyone signed in can read help; only admins can change it. (When the
-- app becomes multi-program, a program_id column lets each program add its
-- own edits over the shared starter text.)
--
-- Additive. Safe to run any time.

create table if not exists public.help_pages (
  page_key   text not null check (page_key ~ '^[a-z0-9_-]{1,40}$'),
  audience   text not null check (audience in ('coach', 'player')),
  title      text,
  intro      text,
  steps      jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  guide_url  text check (guide_url is null or guide_url ~ '^https://'),
  sheet_url  text check (sheet_url is null or sheet_url ~ '^https://'),
  video_url  text check (video_url is null or video_url ~ '^https://'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (page_key, audience)
);

alter table public.help_pages enable row level security;

drop policy if exists "help_pages_read" on public.help_pages;
create policy "help_pages_read" on public.help_pages
  for select using (auth.uid() is not null);

drop policy if exists "help_pages_admin_insert" on public.help_pages;
create policy "help_pages_admin_insert" on public.help_pages
  for insert with check (public.is_admin(auth.uid()));

drop policy if exists "help_pages_admin_update" on public.help_pages;
create policy "help_pages_admin_update" on public.help_pages
  for update using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "help_pages_admin_delete" on public.help_pages;
create policy "help_pages_admin_delete" on public.help_pages
  for delete using (public.is_admin(auth.uid()));

-- Stamp who changed it and when, whatever the client sends.
create or replace function public.help_pages_stamp()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists help_pages_stamp on public.help_pages;
create trigger help_pages_stamp before insert or update on public.help_pages
  for each row execute function public.help_pages_stamp();
