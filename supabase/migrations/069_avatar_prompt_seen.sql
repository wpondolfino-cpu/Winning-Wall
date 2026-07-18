-- 069_avatar_prompt_seen.sql
-- Tracks whether a player has already been shown (and either completed or
-- skipped) the one-time "set up your avatar" prompt on first login, so it
-- doesn't reappear on every subsequent login. Building an avatar later from
-- My Profile also sets this, in case it's ever true without them having
-- seen the dedicated prompt (e.g. an existing player who builds one on
-- their own before ever hitting the prompt path).

alter table public.profiles
  add column if not exists avatar_prompt_seen boolean not null default false;
