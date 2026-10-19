-- ============================================================
-- 193_setup_checklist.sql
--
-- For the new-program setup checklist and invited head coaches: the
-- Platform overview now says when each head coach last used the app
-- (empty = invited but hasn't signed in yet).
--
-- Small and safe: it only adds one field to what platform_programs()
-- returns. One transaction.
-- ============================================================

begin;
do $$
declare src text;
begin
  select pg_get_functiondef('public.platform_programs()'::regprocedure) into src;
  if position('''last_seen''' in src) = 0 then
    src := replace(src,
      'jsonb_build_object(''id'', p.id, ''name'', p.name, ''email'', e.email)',
      'jsonb_build_object(''id'', p.id, ''name'', p.name, ''email'', e.email, ''last_seen'', p.last_seen_at)');
    if position('''last_seen''' in src) = 0 then
      raise exception '193: platform_programs() is not the version from 190 -- nothing was changed';
    end if;
    execute src;
  end if;
end $$;
commit;

-- Check: should say yes
select 'head coaches include last seen' as item,
       case when pg_get_functiondef('public.platform_programs()'::regprocedure) like '%''last_seen''%' then 'yes' else 'NO' end as value;
