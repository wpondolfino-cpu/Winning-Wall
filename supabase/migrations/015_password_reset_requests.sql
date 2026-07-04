-- ─────────────────────────────────────────────────────────────
-- 015_password_reset_requests.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id         uuid primary key default uuid_generate_v4(),
  player_id  uuid references public.profiles(id) on delete cascade,
  name       text not null,
  email      text not null,
  status     text default 'pending' check (status in ('pending', 'done', 'dismissed')),
  created_at timestamptz default now()
);

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can insert a request
CREATE POLICY "anyone_request_reset" ON public.password_reset_requests
  FOR INSERT WITH CHECK (true);

-- Only admins can read and update requests
CREATE POLICY "admins_read_reset" ON public.password_reset_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admins_update_reset" ON public.password_reset_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- RPC to reset a user's password to the temp password
-- Uses service role so it can call auth.users
CREATE OR REPLACE FUNCTION public.reset_user_password(target_user_id uuid, new_password text)
RETURNS void AS $$
BEGIN
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.reset_user_password(uuid, text) TO authenticated;
