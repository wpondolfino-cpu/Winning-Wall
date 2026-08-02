-- 096_inseason_history.sql
-- Mirrors season_history's shape (021_season_history.sql) for the
-- in-season side -- one row per rostered player, snapshotting their
-- practice-win totals before a reset. roster_id/roster_name capture
-- their team at archive time (their live roster could change or be
-- cleared later, so this needs its own copy, same reasoning as
-- season_history capturing grade_category directly).

CREATE TABLE IF NOT EXISTS public.inseason_history (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid references public.profiles(id) on delete cascade,
  season_label    text not null,
  roster_id       uuid,
  roster_name     text,
  overall_rank    integer,
  roster_rank     integer,
  total_wins      integer default 0,
  created_at      timestamptz default now()
);

create index if not exists inseason_history_label_idx on public.inseason_history(season_label);

ALTER TABLE public.inseason_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ih_read_own"  ON public.inseason_history FOR SELECT USING (auth.uid() = player_id);
CREATE POLICY "ih_admin_all" ON public.inseason_history FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','coach'))
);
