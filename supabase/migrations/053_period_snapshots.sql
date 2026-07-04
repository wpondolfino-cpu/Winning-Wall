-- Period snapshots — frozen leaderboard per crowned period
CREATE TABLE IF NOT EXISTS public.period_snapshots (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  period_name  text NOT NULL,           -- e.g. "Week 1 & 2"
  period_start date NOT NULL,
  period_end   date NOT NULL,
  snapshot     jsonb NOT NULL,          -- full ranked player list
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE public.period_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coaches can read snapshots" ON public.period_snapshots
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('coach','admin','player'))
  );
CREATE POLICY "Coaches can insert snapshots" ON public.period_snapshots
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('coach','admin'))
  );
