-- ============================================================
-- 172_close_anonymous_reads.sql
--
-- 32 live policies are "for select to public using (true)". "public"
-- includes the anon role, i.e. anyone holding the anon key — and the
-- anon key ships inside the app's JavaScript, so anyone on the
-- internet can read those tables WITHOUT logging in. That includes
-- player names (records.player_name, biweekly_champions.player_name),
-- scores, streaks, rosters, practice weeks and the drill library.
--
-- STEP 1 — confirm first (read-only). If this returns rows, the
-- exposure is real:
--
--   select table_name from information_schema.role_table_grants
--   where grantee = 'anon' and privilege_type = 'SELECT'
--     and table_schema = 'public'
--   order by 1;
--
-- STEP 2 — run the rest of this file.
--
-- Impact: logged-out visitors can no longer READ any table. Nothing in
-- the app reads before login — the only logged-out call is the
-- "forgot password" form, which INSERTS into password_reset_requests,
-- and inserts are untouched. Logged-in users are unaffected: they use
-- the "authenticated" role, not "anon".
-- ============================================================

revoke select on all tables in schema public from anon;

-- New tables created later won't hand anon read access by default.
alter default privileges in schema public revoke select on tables from anon;

-- STEP 3 — re-run the STEP 1 query; it should return nothing.
