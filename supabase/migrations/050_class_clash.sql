-- Class Clash competition table
CREATE TABLE IF NOT EXISTS public.class_clash_competitions (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title            text NOT NULL DEFAULT 'Class Clash',
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  first_place_pts  int  NOT NULL DEFAULT 5,
  second_place_pts int  NOT NULL DEFAULT 2,
  is_active        boolean NOT NULL DEFAULT true,
  awarded          boolean NOT NULL DEFAULT false,
  created_at       timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.class_clash_competitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read class clash" ON public.class_clash_competitions FOR SELECT USING (true);
CREATE POLICY "Coaches can manage class clash" ON public.class_clash_competitions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('coach','admin'))
);
