-- 086_period_snapshots_staff_delete.sql
-- Safety net: ensures coaches/admins can actually delete period_snapshots
-- rows. This is purely additive (see the same reasoning as migration 059)
-- — if delete access already worked, this changes nothing.

drop policy if exists "staff_delete_period_snapshots" on public.period_snapshots;
create policy "staff_delete_period_snapshots"
  on public.period_snapshots for delete
  using (
    auth.uid() in (select id from public.profiles where role in ('coach', 'admin'))
  );
