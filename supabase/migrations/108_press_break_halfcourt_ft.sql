-- 108_press_break_halfcourt_ft.sql
-- Three GameTracker changes that share one migration because they all
-- touch the same two check constraints.
--
-- 1. Press break (us on offense). A possession that starts against a
--    press records WHICH press in press_break_type_id (a play_calls row
--    under the new 'press_type' category) and what it turned into in
--    press_break_result.
--
--    Deliberately, press_break_type_id -- not possession_type -- is the
--    durable marker of "this was a press break". Once the break flows
--    into transition or a half-court look, possession_type BECOMES
--    'transition' or 'half_court', so those points land in transition
--    PPP and half-court PPP with no change to any existing calculation.
--    possession_type only stays 'press_break' when the trip ended
--    against the press itself (turnover, FT trip, and-1).
--
-- 2. Half-court structure splits from Set/Motion into four values.
--    'zone' means a zone set, which is also how the report knows the
--    possession was played against a zone -- there is deliberately no
--    separate defense_faced column, since it would be a second copy of
--    the same fact and could drift out of sync. 'unscripted' is a trip
--    with no called structure and therefore no play call.
--
--    oob_defense is a different question at a different moment: what
--    they were in ON THE INBOUNDS. A team can go zone on a BLOB and
--    match up man afterwards, so the two are stored separately and
--    neither overrides the other.
--
-- 3. Free throws that didn't come from an offensive possession --
--    end-of-game intentional fouls, technicals, flagrants. These get
--    possession_type 'non_possession_ft' and are excluded from every
--    rate stat's numerator AND denominator, while still counting on the
--    scoreboard and in FT%.
--
--    The end-of-game subtype converts to a real possession the moment an
--    offensive rebound happens on it -- that conversion is just
--    possession_type flipping to 'half_court', so it needs no schema of
--    its own. ft_award_type survives the conversion so the report can
--    still say they hacked us six times.

-- ── possessions.possession_type ───────────────────────────────
alter table public.possessions drop constraint if exists possessions_possession_type_check;
alter table public.possessions add constraint possessions_possession_type_check
  check (possession_type in ('transition', 'half_court', 'blob', 'slob', 'press', 'press_break', 'non_possession_ft'));

-- ── possessions.half_court_type ───────────────────────────────
alter table public.possessions drop constraint if exists possessions_half_court_type_check;
alter table public.possessions add constraint possessions_half_court_type_check
  check (half_court_type in ('set', 'motion', 'unscripted', 'zone'));

-- ── play_calls.category ───────────────────────────────────────
-- 'zone' holds zone sets (a real play list, picked the same way as sets).
-- 'press_type' holds the presses we attack -- Trap, 2-2-1, 1-2-1-1 and so
-- on. Those are the opponent's alignment rather than our call, which is
-- exactly why they live in press_break_type_id and leave play_call_id
-- free for the set a break flows into.
alter table public.play_calls drop constraint if exists play_calls_category_check;
alter table public.play_calls add constraint play_calls_category_check
  check (category in ('set', 'motion', 'blob', 'slob', 'zone', 'press_type'));

-- ── new possession columns ────────────────────────────────────
alter table public.possessions
  add column if not exists press_break_type_id uuid references public.play_calls(id) on delete set null;

alter table public.possessions
  add column if not exists press_break_result text;
alter table public.possessions drop constraint if exists possessions_press_break_result_check;
alter table public.possessions add constraint possessions_press_break_result_check
  check (press_break_result is null or press_break_result in ('transition', 'half_court', 'turnover', 'oob', 'ft_trip'));

alter table public.possessions
  add column if not exists oob_defense text;
alter table public.possessions drop constraint if exists possessions_oob_defense_check;
alter table public.possessions add constraint possessions_oob_defense_check
  check (oob_defense is null or oob_defense in ('man', 'zone'));

alter table public.possessions
  add column if not exists ft_award_type text;
alter table public.possessions drop constraint if exists possessions_ft_award_type_check;
alter table public.possessions add constraint possessions_ft_award_type_check
  check (ft_award_type is null or ft_award_type in ('eog', 'technical', 'flagrant'));

create index if not exists possessions_press_break_type_idx on public.possessions(press_break_type_id);

-- ── saved_reports.category ────────────────────────────────────
-- Already out of date before this migration ('press' was added to
-- possession_type back in 073 and never here), so it's brought fully in
-- line rather than just extended by the two new values.
alter table public.saved_reports drop constraint if exists saved_reports_category_check;
alter table public.saved_reports add constraint saved_reports_category_check
  check (category in ('all', 'transition', 'half_court', 'blob', 'slob', 'press', 'press_break', 'non_possession_ft'));
