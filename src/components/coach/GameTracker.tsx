// src/components/coach/GameTracker.tsx
// Live, offline-first possession entry. Every tap queues locally via
// gameStats.queuePossession and syncs in the background -- the coach never
// waits on the network mid-game. One possession = one true offensive trip;
// an OREB extends the current trip (increments oreb_count) instead of
// starting a new one.
//
// OREB is no longer a standalone button -- a missed shot (or a missed free
// throw) is a "pendingCommit" that doesn't save yet; instead it asks
// "Offensive rebound?" Yes/No. No commits the miss as the trip's final
// result (defensive rebound implied). Yes keeps the trip alive, tallies
// missed_fg_count (for FG misses only, not FT misses -- OREB% is
// conventionally measured against missed field goals), and routes into the
// shared action_branch (Shot / Turnover / Set-Motion) for what happens
// next. This also means a missed shot that gets rebounded is now actually
// recorded as a miss (shot_type/quality included) instead of vanishing
// into an untracked oreb_count bump, like it did before. A missed free
// throw that gets rebounded gets the same treatment via
// absorbed_ft_attempts/absorbed_ft_made -- both its attempt count and its
// points (if some were made) get folded into whatever the trip eventually
// ends with, instead of silently disappearing.
//
// On defense the OREB question still applies (their own rebound of their
// own miss) but skips shot quality entirely, straight from Miss to the
// question.
//
// action_branch: Shot / Turnover / (Set / Motion, us only). Shot skips
// straight to a reduced outcome grid (no Turnover button -- that's already
// branched separately). Set/Motion route through the normal play-call
// picker into the full "traditional half-court" outcome grid (includes
// Turnover). Paint touch/both sides show there UNLESS the trip is a
// direct BLOB/SLOB with no OREB in it (we don't track paint touch on raw
// inbounds plays) -- once an OREB happens, paint touch becomes trackable
// again even for a BLOB/SLOB-originated trip, since flowing into a real
// Set/Motion after a rebound is functionally a half-court possession.
//
// The team toggle (us on offense / us on defense) auto-flips after every
// committed possession, since basketball possessions alternate -- undo
// reverts the flip along with the possession it's undoing. On defense we
// skip shot quality and play-calling (Set/Motion/BLOB/SLOB picker)
// entirely -- we're coaching our own shot selection, not judging theirs,
// and we don't know the name of a play we didn't call. FT trips ask
// attempts (1/2/3 shots) before makes, so FT% is computable -- and are
// auto-tagged "great" quality, but only on our own trips to the line.
//
// Defense also gets its own possession-type screen: Transition, Man, Zone,
// Press, BLOB, SLOB (instead of offense's Transition/Half-court/BLOB/SLOB).
// Man and Zone both go straight to the outcome screen -- there's no
// play-calling for either since we don't know what set they're actually
// running, we're just tagging which defense we called (defense_scheme).
// Press asks Turnover / Man / Zone: Turnover goes to the usual live/dead
// ball screen, Man/Zone tag defense_scheme the same way a direct call
// would and count toward those same Man/Zone effectiveness numbers,
// while press_result keeps track of what the press itself turned into
// (forced turnover vs. broke down into a half-court look) for press
// effectiveness specifically. possession_type stays 'press' through an
// OREB, same as blob/slob, so it keeps counting toward press effectiveness
// even if the trip continues.
//
// BLOB/SLOB/Set/Motion/Zone pickers also surface any play drawn in the
// Plays feature and tagged with that category (case-insensitive), not just
// play_calls added inline here -- see gameStats.ts's fetchDrawnPlaysForCategory.
//
// Us on offense (migration 108):
//
// BLOB is no longer a STARTING possession type -- we never start a trip
// with one. It's still reachable, and still real, via Foul/Jump/OOB
// reclassifying a live trip, which is how a BLOB actually happens.
//
// Press break: pick which press (a play_calls row under 'press_type'),
// then what it turned into. Transition and half-court REPLACE the
// possession type, so those points land in transition PPP and half-court
// PPP with no special case anywhere downstream -- press_break_type_id is
// what durably marks the trip as a break. Only a trip that ended against
// the press (turnover, FT trip) keeps possession_type 'press_break'.
//
// Half-court structure is four buttons rather than two: Man set, Motion,
// Zone set, Unscripted. Zone set is also the record that we were playing
// against a zone, which is why there's no separate defense_faced field --
// it would be a second copy of the same fact. Unscripted has no play list
// and skips the play-call step. All four appear at every entry point into
// a half-court look (the half-court flow, post-OREB, BLOB/SLOB, press
// break), via the shared HalfCourtButtons component.
//
// oob_defense tags what they were in ON THE INBOUNDS, which is a separate
// question at a separate moment from half_court_type -- a team can go zone
// on a BLOB and match up man after, so neither overrides the other. It's
// optional; the report shows how many trips were tagged so the untagged
// ones can be fixed in the editor rather than silently skewing a split.
//
// EOG FTs/Tech (both tabs): free throws that didn't come from an
// offensive possession. Three subtypes -- end of game, technical,
// flagrant -- all flagged possession_type 'non_possession_ft' and
// excluded from every rate stat top and bottom, while still counting on
// the scoreboard and in FT%. Only end-of-game is a live ball, so only it
// asks the rebound question; saying yes flips possession_type to
// half_court, which IS the conversion into a real possession. Technicals
// and flagrants also don't flip the team toggle, since the ball can go
// either way and guessing wrong misattributes the next trip.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  queuePossession,
  queueCount,
  getLastSyncErrors,
  fetchDrawnPlaysForCategory,
  ensurePlayCallForPlay,
  periodLabel,
  DEFAULT_GAME_FORMAT,
  type GameFormat,
  type Possession,
  type PlayCall,
  type PlayCallCategory,
  type DrawnPlay,
  type Team,
  type PossessionType,
  type HalfCourtType,
  type OobResult,
  type DefenseScheme,
  type PressResult,
  type PressBreakResult,
  type OobDefense,
  type FtAwardType,
  type Outcome,
  DEFAULT_PRESS_TYPES,
} from "../../lib/gameStats";

interface Props {
  gameId: string;
  userId: string;
  quarter: number;
  /** Period structure, so the header reads H1 or S2 rather than always Q1. Optional so any older call site still works. */
  format?: GameFormat;
  /** In an intrasquad practice both teams are ours, so "Us on defense" is wrong. */
  intrasquad?: boolean;
}

type Step =
  | "type"
  | "halfcourt_type"
  | "play_call"
  | "oob_result"
  | "oob_reclassify"
  | "press_result"
  | "press_break_type"
  | "press_break_result"
  | "ft_award_type"
  | "action_branch"
  | "quick_shot"
  | "flags"
  | "turnover_type"
  | "shot_quality"
  | "and1_shot"
  | "and1_ft"
  | "oreb_check"
  | "ft_attempts"
  | "ft_points";

interface PendingShot {
  shotType: 2 | 3;
  made: boolean;
}

interface PendingCommit {
  outcome: Outcome;
  extra: Partial<Possession>;
  isFgMiss: boolean; // whether this is a missed FG (vs a missed FT) -- decides whether confirming an OREB adds to missed_fg_count
  label: string; // shown on the oreb_check screen, e.g. "missed 2" or "missed FT"
}

interface FlowSnapshot {
  step: Step;
  possessionType: PossessionType | null;
  halfCourtType: HalfCourtType | null;
  playCallId: string | null;
  oobResult: OobResult | null;
  defenseScheme: DefenseScheme | null;
  pressResult: PressResult | null;
  pressBreakTypeId: string | null;
  pressBreakResult: PressBreakResult | null;
  oobDefense: OobDefense | null;
  ftAwardType: FtAwardType | null;
  paintTouch: boolean;
  paintTouchBoth: boolean;
  orebCount: number;
  missedFgCount: number;
  absorbedFtAttempts: number;
  absorbedFtMade: number;
  pendingShot: PendingShot | null;
  pendingCommit: PendingCommit | null;
  orebOccurred: boolean;
  ftAttempts: 1 | 2 | 3 | null;
}

const QUARTER_ACCENT: Record<number, string> = { 1: "#3b6fd6", 2: "#2f9e63", 3: "#c9932f", 4: "#c2402f" };
const DEFENSE_ACCENT = "#c2703a";

export default function GameTracker({ gameId, userId, quarter, format = DEFAULT_GAME_FORMAT, intrasquad = false }: Props) {
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [drawnPlays, setDrawnPlays] = useState<Record<PlayCallCategory, DrawnPlay[]>>({ set: [], motion: [], blob: [], slob: [], zone: [], press_type: [] });
  const [unsynced, setUnsynced] = useState(0);
  const [syncErrorCount, setSyncErrorCount] = useState(0);
  const [sequence, setSequence] = useState(1);
  const [log, setLog] = useState<Possession[]>([]);

  const [team, setTeam] = useState<Team>("us");
  const [step, setStep] = useState<Step>("type");
  const [possessionType, setPossessionType] = useState<PossessionType | null>(null);
  const [halfCourtType, setHalfCourtType] = useState<HalfCourtType | null>(null);
  const [playCallId, setPlayCallId] = useState<string | null>(null);
  const [oobResult, setOobResult] = useState<OobResult | null>(null);
  const [defenseScheme, setDefenseScheme] = useState<DefenseScheme | null>(null);
  const [pressResult, setPressResult] = useState<PressResult | null>(null);
  const [pressBreakTypeId, setPressBreakTypeId] = useState<string | null>(null);
  const [pressBreakResult, setPressBreakResult] = useState<PressBreakResult | null>(null);
  const [oobDefense, setOobDefense] = useState<OobDefense | null>(null);
  const [ftAwardType, setFtAwardType] = useState<FtAwardType | null>(null);
  const [paintTouch, setPaintTouch] = useState(false);
  const [paintTouchBoth, setPaintTouchBoth] = useState(false);
  const [orebCount, setOrebCount] = useState(0);
  const [missedFgCount, setMissedFgCount] = useState(0);
  const [absorbedFtAttempts, setAbsorbedFtAttempts] = useState(0);
  const [absorbedFtMade, setAbsorbedFtMade] = useState(0);
  const [pendingShot, setPendingShot] = useState<PendingShot | null>(null);
  const [pendingCommit, setPendingCommit] = useState<PendingCommit | null>(null);
  const [orebOccurred, setOrebOccurred] = useState(false); // true once any OREB happens in this trip
  const [ftAttempts, setFtAttempts] = useState<1 | 2 | 3 | null>(null);
  const [newPlayName, setNewPlayName] = useState("");
  const [addingPlayFor, setAddingPlayFor] = useState<PlayCallCategory | null>(null);
  const [history, setHistory] = useState<FlowSnapshot[]>([]);

  useEffect(() => {
    loadPlayCalls();
    refreshUnsynced();
    const t = setInterval(refreshUnsynced, 4000);
    return () => clearInterval(t);
  }, []);

  async function loadPlayCalls() {
    const { data } = await supabase.from("play_calls").select("*").eq("status", "active");
    let calls = (data as PlayCall[]) ?? [];
    calls = await seedPressTypes(calls);
    setPlayCalls(calls);
    // Only categories a coach actually draws plays for. Press types are the
    // opponent's alignment rather than our call, so there's nothing in the
    // Plays feature to surface for them.
    const categories: PlayCallCategory[] = ["set", "motion", "blob", "slob", "zone"];
    const results = await Promise.all(categories.map((c) => fetchDrawnPlaysForCategory(c)));
    // press_type is in the Record because it's a PlayCallCategory, but
    // presses are the opponent's alignment -- there's nothing in the Plays
    // feature to surface, so it stays empty rather than being fetched.
    setDrawnPlays({ set: results[0], motion: results[1], blob: results[2], slob: results[3], zone: results[4], press_type: [] });
  }

  /**
   * Seeds the five common presses the first time the tracker loads with
   * none, so the press picker isn't an empty screen mid-game. They're
   * ordinary play calls afterwards -- renameable, and "+ Add" takes any
   * press this list doesn't have.
   */
  async function seedPressTypes(calls: PlayCall[]): Promise<PlayCall[]> {
    if (calls.some((c) => c.category === "press_type")) return calls;
    const { data, error } = await supabase
      .from("play_calls")
      .insert(DEFAULT_PRESS_TYPES.map((name) => ({ category: "press_type", name, created_by: userId })))
      .select();
    if (error || !data) return calls;
    return [...calls, ...(data as PlayCall[])];
  }

  async function refreshUnsynced() {
    setUnsynced(await queueCount());
    setSyncErrorCount(getLastSyncErrors().length);
  }

  function showSyncErrors() {
    const errors = getLastSyncErrors();
    if (!errors.length) return;
    alert(`${errors.length} possession(s) failed to sync:\n\n${errors.map((e) => e.message).join("\n")}`);
  }

  function resetForNextPossession() {
    setStep("type");
    setPossessionType(null);
    setHalfCourtType(null);
    setPlayCallId(null);
    setOobResult(null);
    setDefenseScheme(null);
    setPressResult(null);
    setPressBreakTypeId(null);
    setPressBreakResult(null);
    setOobDefense(null);
    setFtAwardType(null);
    setPaintTouch(false);
    setPaintTouchBoth(false);
    setOrebCount(0);
    setMissedFgCount(0);
    setAbsorbedFtAttempts(0);
    setAbsorbedFtMade(0);
    setPendingShot(null);
    setPendingCommit(null);
    setOrebOccurred(false);
    setFtAttempts(null);
    setHistory([]);
  }

  /** Snapshots the current flow state before advancing a step, so goBack can restore it exactly. */
  function pushHistory() {
    setHistory((h) => [
      ...h,
      {
        step, possessionType, halfCourtType, playCallId, oobResult, defenseScheme, pressResult,
        pressBreakTypeId, pressBreakResult, oobDefense, ftAwardType, paintTouch, paintTouchBoth,
        orebCount, missedFgCount, absorbedFtAttempts, absorbedFtMade, pendingShot, pendingCommit, orebOccurred, ftAttempts,
      },
    ]);
  }

  function goBack() {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setStep(prev.step);
      setPossessionType(prev.possessionType);
      setHalfCourtType(prev.halfCourtType);
      setPlayCallId(prev.playCallId);
      setOobResult(prev.oobResult);
      setDefenseScheme(prev.defenseScheme);
      setPressResult(prev.pressResult);
      setPressBreakTypeId(prev.pressBreakTypeId);
      setPressBreakResult(prev.pressBreakResult);
      setOobDefense(prev.oobDefense);
      setFtAwardType(prev.ftAwardType);
      setPaintTouch(prev.paintTouch);
      setPaintTouchBoth(prev.paintTouchBoth);
      setOrebCount(prev.orebCount);
      setMissedFgCount(prev.missedFgCount);
      setAbsorbedFtAttempts(prev.absorbedFtAttempts);
      setAbsorbedFtMade(prev.absorbedFtMade);
      setPendingShot(prev.pendingShot);
      setPendingCommit(prev.pendingCommit);
      setOrebOccurred(prev.orebOccurred);
      setFtAttempts(prev.ftAttempts);
      return h.slice(0, -1);
    });
  }

  async function commit(outcome: Outcome, extra: Partial<Possession> = {}) {
    const possession: Possession = {
      id: crypto.randomUUID(),
      game_id: gameId,
      team,
      quarter,
      sequence,
      possession_type: possessionType!,
      half_court_type: halfCourtType,
      play_call_id: playCallId,
      oob_result: oobResult,
      defense_scheme: defenseScheme,
      press_result: pressResult,
      press_break_type_id: pressBreakTypeId,
      press_break_result: pressBreakResult,
      oob_defense: oobDefense,
      ft_award_type: ftAwardType,
      paint_touch: paintTouch,
      paint_touch_both_sides: paintTouchBoth,
      oreb_count: orebCount,
      missed_fg_count: missedFgCount,
      absorbed_ft_attempts: absorbedFtAttempts,
      absorbed_ft_made: absorbedFtMade,
      outcome,
      shot_type: null,
      shot_quality: null,
      turnover_type: null,
      ft_attempts: null,
      points: 0,
      created_by: userId,
      created_at: new Date().toISOString(),
      ...extra,
    };
    // Absorbed FT makes are real points scored earlier in this same trip
    // (a free throw made before a miss got offensive-rebounded) -- the
    // final action's own points alone would undercount the trip.
    possession.points += absorbedFtMade;
    await queuePossession(possession);
    setLog((l) => [...l, possession]);
    setSequence((s) => s + 1);
    refreshUnsynced();
    // Possessions alternate, so committing one normally flips the toggle.
    // A technical or flagrant doesn't: the ball can go either way
    // depending on the rule set and the situation, and guessing wrong
    // silently misattributes the next trip. End-of-game fouling DOES flip
    // -- we shoot, they inbound. (A trip that converted off a rebound is
    // no longer possession_type non_possession_ft by now, so it flips
    // like any other possession.)
    const dead = possession.possession_type === "non_possession_ft" && ftAwardType !== "eog";
    if (!dead) setTeam((t) => (t === "us" ? "opponent" : "us"));
    resetForNextPossession();
  }

  /** Make: commits immediately (with quality, for us). Miss: doesn't commit
      yet -- it becomes a pendingCommit and routes to "offensive rebound?"
      first, since only a make or an unrebounded miss actually ends a trip. */
  function commitPendingShot(quality: "great" | "good" | "live" | "tough") {
    if (!pendingShot) return;
    if (pendingShot.made) {
      commit("fg_made", { shot_type: pendingShot.shotType, points: pendingShot.shotType, shot_quality: quality });
    } else {
      pushHistory();
      setPendingCommit({
        outcome: "fg_missed",
        extra: { shot_type: pendingShot.shotType, points: 0, shot_quality: quality },
        isFgMiss: true,
        label: `missed ${pendingShot.shotType}`,
      });
      setStep("oreb_check");
    }
  }

  /** And-1 is its own button (next to FT trip), not a prompt after every
      make -- picking a shot type here skips shot_quality/quality choice
      entirely, since a bonus FT trip auto-grades as "great" the same way
      a plain FT trip already does. */
  function selectAnd1Shot(shotType: 2 | 3) {
    pushHistory();
    setPendingShot({ shotType, made: true });
    setStep("and1_ft");
  }

  /** Shared by every Make/Miss button (flags screen and quick_shot screen).
      Shot quality is now graded on BOTH ends. On defence it answers the
      question outcomes can't: did we force a bad shot they happened to
      make, or give up a good look they happened to miss? The buttons grade
      the shot itself, so they mean the same thing either way -- only who
      benefits flips, which the report handles by inverting the goal. */
  function selectShot(shotType: 2 | 3, made: boolean) {
    pushHistory();
    setPendingShot({ shotType, made });
    setStep("shot_quality");
  }

  /** "No" on the OREB question -- the pending miss (FG or FT) is the trip's
      final result, so it commits as-is. */
  function declineOreb() {
    if (pendingCommit) commit(pendingCommit.outcome, pendingCommit.extra);
    setPendingCommit(null);
  }

  /** "Yes" on the OREB question -- the trip stays alive. If the pending
      thing was a missed FG (not FT), it counts toward missed_fg_count so
      OREB% has an accurate denominator. If the trip originated as a
      BLOB/SLOB we keep that possession_type (so it still counts toward
      BLOB/SLOB effectiveness) -- otherwise it becomes a half-court trip,
      since the putback itself is a half-court-style action. */
  function confirmOreb() {
    pushHistory();
    setOrebCount((c) => c + 1);
    if (pendingCommit?.isFgMiss) setMissedFgCount((c) => c + 1);
    if (pendingCommit && pendingCommit.outcome === "ft_trip") {
      setAbsorbedFtAttempts((c) => c + ((pendingCommit.extra.ft_attempts as number) ?? 0));
      setAbsorbedFtMade((c) => c + ((pendingCommit.extra.points as number) ?? 0));
    }
    // A press break or an end-of-game FT trip that gets rebounded becomes
    // a genuine half-court possession here -- which is exactly how the
    // end-of-game conversion works: once possession_type stops being
    // "non_possession_ft" it counts everywhere, while ft_award_type still
    // records that they hacked us to get there.
    if (possessionType !== "blob" && possessionType !== "slob" && possessionType !== "press") {
      setPossessionType("half_court");
      setHalfCourtType(null);
      setPlayCallId(null);
    }
    setPaintTouch(false);
    setPaintTouchBoth(false);
    setOrebOccurred(true);
    setPendingCommit(null);
    setStep("action_branch");
  }

  function undo() {
    const last = log[log.length - 1];
    setLog((l) => l.slice(0, -1));
    setSequence((s) => Math.max(1, s - 1));
    // Mirrors the commit rule: only un-flip if committing that row flipped.
    const wasDead = last && last.possession_type === "non_possession_ft" && last.ft_award_type !== "eog";
    if (!wasDead) setTeam((t) => (t === "us" ? "opponent" : "us"));
    // Local-log undo only -- once a possession has synced, correcting it
    // is an edit on the report screen, not a live undo.
  }

  async function addPlayCall(category: PlayCallCategory) {
    if (!newPlayName.trim()) return;
    const trimmedName = newPlayName.trim();
    // Without this check, typing a name that already exists in this
    // category (e.g. "Push" already exists, coach adds it again without
    // noticing) creates a second, separate play call with the same name —
    // every future possession only gets tagged to whichever one gets
    // picked, silently splitting what should be one play's count across
    // two rows. Reuse the existing one instead of creating a duplicate.
    const existing = playCalls.find((p) => p.category === category && p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    if (existing) {
      pushHistory();
      if (category === "press_type") setPressBreakTypeId(existing.id);
      else setPlayCallId(existing.id);
      setNewPlayName("");
      setAddingPlayFor(null);
      setStep(afterPlayCallStep(category));
      return;
    }
    const { data, error } = await supabase
      .from("play_calls")
      .insert({ category, name: trimmedName, created_by: userId })
      .select()
      .single();
    if (!error && data) {
      pushHistory();
      setPlayCalls((p) => [...p, data as PlayCall]);
      if (category === "press_type") setPressBreakTypeId((data as PlayCall).id);
      else setPlayCallId((data as PlayCall).id);
      setNewPlayName("");
      setAddingPlayFor(null);
      setStep(afterPlayCallStep(category));
    }
  }

  /** Renaming is separate from creating one -- lets a play named on the
      fly mid-game (e.g. "Blob 3") get a real name later without losing
      its history, since every past possession already links to this
      same id. */
  async function renamePlayCall(pc: PlayCall) {
    const next = window.prompt("Rename this play:", pc.name);
    if (!next || !next.trim() || next.trim() === pc.name) return;
    const { error } = await supabase.from("play_calls").update({ name: next.trim() }).eq("id", pc.id);
    if (!error) setPlayCalls((list) => list.map((p) => (p.id === pc.id ? { ...p, name: next.trim() } : p)));
  }

  async function pickDrawnPlay(dp: DrawnPlay, category: PlayCallCategory, nextStep: Step) {
    const pc = await ensurePlayCallForPlay(dp, category, userId);
    if (!pc) return;
    pushHistory();
    setPlayCalls((list) => (list.some((x) => x.id === pc.id) ? list : [...list, pc]));
    setPlayCallId(pc.id);
    setStep(nextStep);
  }

  const playsForCategory = (cat: PlayCallCategory) => playCalls.filter((p) => p.category === cat);
  const unlinkedDrawnFor = (cat: PlayCallCategory) =>
    drawnPlays[cat].filter((dp) => !playCalls.some((pc) => pc.linked_play_id === dp.id));

  /**
   * The four half-court structure buttons, shared by every entry point
   * into a half-court look: the half-court flow itself, action_branch
   * (post-OREB), the BLOB/SLOB flow, and a press break that got broken.
   *
   * "Unscripted" has no play list by design -- it's the trip with no
   * called structure -- so it skips the play-call step entirely.
   */
  function chooseHalfCourtType(type: HalfCourtType) {
    pushHistory();
    if (possessionType === "blob" || possessionType === "slob") setOobResult("flowed_half_court");
    setHalfCourtType(type);
    setStep(type === "unscripted" ? "flags" : "play_call");
  }

  /** Where a play-call pick lands next, by the list it came from rather than by possession type -- a press break that flowed into a set is possession_type half_court by then. */
  function afterPlayCallStep(category: PlayCallCategory): Step {
    if (category === "press_type") return "press_break_result";
    if (category === "blob" || category === "slob") return "oob_result";
    return "flags";
  }

  /**
   * Press break outcomes. Transition and half-court REPLACE the possession
   * type rather than sitting alongside it -- press_break_type_id is what
   * remembers this was a break, so the points land in transition PPP and
   * half-court PPP where they belong instead of in a bucket of their own.
   * Only a trip that ended against the press (turnover, FT trip) stays
   * possession_type "press_break".
   */
  function choosePressBreakResult(result: PressBreakResult, nextStep: Step, becomes?: PossessionType) {
    pushHistory();
    setPressBreakResult(result);
    if (becomes) setPossessionType(becomes);
    setStep(nextStep);
  }

  function chooseShot() {
    pushHistory();
    if (possessionType === "blob" || possessionType === "slob") setOobResult("direct_shot");
    setStep("quick_shot");
  }

  function chooseTurnover() {
    pushHistory();
    if (possessionType === "blob" || possessionType === "slob") setOobResult("turnover");
    setStep("turnover_type");
  }

  /**
   * The play list behind the chosen structure. Null for "unscripted",
   * which has none -- so the play_call step can't render for it.
   *
   * Written as an explicit comparison rather than a cast: HalfCourtType
   * and PlayCallCategory overlap but neither contains the other, so a cast
   * would be asserting something the compiler can't check. This narrows to
   * the three values that genuinely are categories.
   */
  const halfCourtCategory: PlayCallCategory | null =
    halfCourtType === "set" || halfCourtType === "motion" || halfCourtType === "zone" ? halfCourtType : null;

  const teamAccent = team === "us" ? "var(--royal)" : DEFENSE_ACCENT;
  const quarterAccent = QUARTER_ACCENT[quarter] ?? "#8a4fbe";

  return (
    <div
      className="card"
      style={{ width: "100%", maxWidth: 1400, borderTop: `4px solid ${teamAccent}`, borderLeft: `4px solid ${quarterAccent}` }}
    >
      <style>{`
        .gt-grid { display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: 8px; }
        @media (max-width: 480px) {
          .gt-grid { grid-template-columns: repeat(var(--cols-mobile), 1fr); }
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{periodLabel(format, quarter)} · Possession {sequence}</span>
        <span
          style={{ fontSize: 12, color: syncErrorCount ? "#c2402f" : unsynced ? "#e0a530" : "var(--muted)", cursor: syncErrorCount ? "pointer" : "default" }}
          onClick={syncErrorCount ? showSyncErrors : undefined}
        >
          {syncErrorCount ? `⚠ ${syncErrorCount} failed to sync (tap for details)` : unsynced ? `${unsynced} unsynced` : "synced"}
        </span>
      </div>

      <div className="role-tabs">
        <button className={`role-tab ${team === "us" ? "active" : ""}`} onClick={() => setTeam("us")}>
          {intrasquad ? "Team 1 on offense" : "Us on offense"}
        </button>
        <button
          className={`role-tab ${team === "opponent" ? "active" : ""}`}
          onClick={() => setTeam("opponent")}
          style={team === "opponent" ? { background: DEFENSE_ACCENT, borderColor: DEFENSE_ACCENT } : undefined}
        >
          {intrasquad ? "Team 2 on offense" : "Us on defense"}
        </button>
      </div>

      {history.length > 0 && (
        <button
          onClick={goBack}
          style={{ marginTop: 10, marginBottom: 10, padding: "6px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", cursor: "pointer" }}
        >
          ← Back
        </button>
      )}

      {step === "type" && team === "us" && (
        <Section label="Possession type">
          <Grid cols={3}>
            <Btn onClick={() => { pushHistory(); setPossessionType("transition"); setStep("flags"); }}>Transition</Btn>
            <Btn
              onClick={() => {
                pushHistory();
                setPossessionType("half_court");
                setOrebOccurred(false);
                setStep("halfcourt_type");
              }}
            >
              Half-court
            </Btn>
            <Btn onClick={() => { pushHistory(); setPossessionType("slob"); setStep("oob_result"); }}>SLOB</Btn>
          </Grid>
          <Grid cols={2} style={{ marginTop: 8 }}>
            <Btn onClick={() => { pushHistory(); setPossessionType("press_break"); setStep("press_break_type"); }}>
              Press break
            </Btn>
            <Btn subtitle="Not a possession" onClick={() => { pushHistory(); setStep("ft_award_type"); }}>
              EOG FTs/Tech
            </Btn>
          </Grid>
        </Section>
      )}

      {step === "type" && team === "opponent" && (
        <Section label="Possession type">
          <Grid cols={3}>
            <Btn onClick={() => { pushHistory(); setPossessionType("transition"); setStep("flags"); }}>Transition</Btn>
            <Btn
              onClick={() => {
                pushHistory();
                setPossessionType("half_court");
                setDefenseScheme("man");
                setOrebOccurred(false);
                setStep("flags");
              }}
            >
              Man
            </Btn>
            <Btn
              onClick={() => {
                pushHistory();
                setPossessionType("half_court");
                setDefenseScheme("zone");
                setOrebOccurred(false);
                setStep("flags");
              }}
            >
              Zone
            </Btn>
            <Btn onClick={() => { pushHistory(); setPossessionType("press"); setStep("press_result"); }}>Press</Btn>
            <Btn onClick={() => { pushHistory(); setPossessionType("blob"); setStep("oob_result"); }}>BLOB</Btn>
            <Btn onClick={() => { pushHistory(); setPossessionType("slob"); setStep("oob_result"); }}>SLOB</Btn>
          </Grid>
          <Grid cols={1} style={{ marginTop: 8 }}>
            {/* A technical on our bench means they shoot -- without this their FT totals come up short. */}
            <Btn subtitle="Not a possession" onClick={() => { pushHistory(); setStep("ft_award_type"); }}>
              EOG FTs/Tech
            </Btn>
          </Grid>
        </Section>
      )}

      {step === "ft_award_type" && (
        <Section label="Why the free throws" accent>
          <Grid cols={3}>
            <Btn
              subtitle="Live ball"
              onClick={() => { pushHistory(); setPossessionType("non_possession_ft"); setFtAwardType("eog"); setStep("ft_attempts"); }}
            >
              End of game
            </Btn>
            <Btn
              subtitle="Dead ball"
              onClick={() => { pushHistory(); setPossessionType("non_possession_ft"); setFtAwardType("technical"); setStep("ft_attempts"); }}
            >
              Technical
            </Btn>
            <Btn
              subtitle="Dead ball"
              onClick={() => { pushHistory(); setPossessionType("non_possession_ft"); setFtAwardType("flagrant"); setStep("ft_attempts"); }}
            >
              Flagrant
            </Btn>
          </Grid>
        </Section>
      )}

      {step === "press_break_type" && (
        <Section label="Which press" accent>
          <PlayCallPicker
            plays={playsForCategory("press_type")}
            drawn={[]}
            selectedId={pressBreakTypeId}
            onPick={(id) => { pushHistory(); setPressBreakTypeId(id); setStep("press_break_result"); }}
            onPickDrawn={() => {}}
            onRename={renamePlayCall}
            adding={addingPlayFor === "press_type"}
            onStartAdd={() => setAddingPlayFor("press_type")}
            newName={newPlayName}
            onNewName={setNewPlayName}
            onSaveNew={() => addPlayCall("press_type")}
          />
        </Section>
      )}

      {step === "press_break_result" && (
        <Section label="What happened" accent>
          <Grid cols={3}>
            <Btn onClick={() => choosePressBreakResult("transition", "flags", "transition")}>Transition</Btn>
            <Btn onClick={() => choosePressBreakResult("half_court", "halfcourt_type", "half_court")}>Half-court</Btn>
            <Btn onClick={() => choosePressBreakResult("turnover", "turnover_type")}>Turnover</Btn>
          </Grid>
          <Grid cols={3} style={{ marginTop: 8 }}>
            <Btn subtitle="Still our ball" onClick={() => choosePressBreakResult("oob", "oob_reclassify")}>
              Foul/Jump/OOB
            </Btn>
            <Btn onClick={() => choosePressBreakResult("ft_trip", "ft_attempts")}>FT trip</Btn>
            {/* Fouled finishing the break, so it's scored as a transition bucket rather than orphaned from both splits. */}
            <Btn onClick={() => choosePressBreakResult("transition", "and1_shot", "transition")}>And-1</Btn>
          </Grid>
        </Section>
      )}

      {step === "press_result" && (
        <Section label="Press result" accent>
          <Grid cols={3}>
            <Btn onClick={() => { pushHistory(); setPressResult("turnover"); setStep("turnover_type"); }}>Turnover</Btn>
            <Btn
              onClick={() => {
                pushHistory();
                setPressResult("man");
                setDefenseScheme("man");
                setStep("flags");
              }}
            >
              Man
            </Btn>
            <Btn
              onClick={() => {
                pushHistory();
                setPressResult("zone");
                setDefenseScheme("zone");
                setStep("flags");
              }}
            >
              Zone
            </Btn>
          </Grid>
        </Section>
      )}

      {step === "halfcourt_type" && (
        <Section label="Half-court type" accent>
          <HalfCourtButtons onChoose={chooseHalfCourtType} />
        </Section>
      )}

      {step === "play_call" && halfCourtCategory && (
        <Section label={halfCourtCategory === "zone" ? "Which zone set" : `Which ${halfCourtCategory}`} accent>
          <PlayCallPicker
            plays={playsForCategory(halfCourtCategory)}
            drawn={unlinkedDrawnFor(halfCourtCategory)}
            selectedId={playCallId}
            onPick={(id) => { pushHistory(); setPlayCallId(id); setStep("flags"); }}
            onPickDrawn={(dp) => pickDrawnPlay(dp, halfCourtCategory, "flags")}
            onRename={renamePlayCall}
            adding={addingPlayFor === halfCourtCategory}
            onStartAdd={() => setAddingPlayFor(halfCourtCategory)}
            newName={newPlayName}
            onNewName={setNewPlayName}
            onSaveNew={() => addPlayCall(halfCourtCategory)}
          />
        </Section>
      )}

      {step === "oob_result" && (possessionType === "blob" || possessionType === "slob") && (
        <>
          {team === "us" && (
            <Section label={`${possessionType.toUpperCase()} play`} accent>
              <PlayCallPicker
                plays={playsForCategory(possessionType)}
                drawn={unlinkedDrawnFor(possessionType)}
                selectedId={playCallId}
                onPick={(id) => { pushHistory(); setPlayCallId(id); }}
                onPickDrawn={(dp) => pickDrawnPlay(dp, possessionType, "oob_result")}
                onRename={renamePlayCall}
                adding={addingPlayFor === possessionType}
                onStartAdd={() => setAddingPlayFor(possessionType)}
                newName={newPlayName}
                onNewName={setNewPlayName}
                onSaveNew={() => addPlayCall(possessionType)}
              />
            </Section>
          )}
          {team === "us" && (
            <Section label="Defense on the inbounds" accent>
              <Grid cols={2}>
                <Btn active={oobDefense === "man"} onClick={() => setOobDefense((v) => (v === "man" ? null : "man"))}>
                  vs man
                </Btn>
                <Btn active={oobDefense === "zone"} onClick={() => setOobDefense((v) => (v === "zone" ? null : "zone"))}>
                  vs zone
                </Btn>
              </Grid>
            </Section>
          )}
          <Section label="What happened" accent>
            <Grid cols={3}>
              <Btn onClick={chooseShot}>Shot</Btn>
              <Btn onClick={chooseTurnover}>Turnover</Btn>
              <Btn
                subtitle={team === "us" ? "Still our ball" : "Still their ball"}
                onClick={() => { pushHistory(); setStep("oob_reclassify"); }}
              >
                Foul/Jump/OOB
              </Btn>
            </Grid>
            {team === "us" && (
              <div style={{ marginTop: 8 }}>
                <HalfCourtButtons onChoose={chooseHalfCourtType} />
              </div>
            )}
          </Section>
        </>
      )}

      {step === "action_branch" && (
        <Section label="What happened">
          <Grid cols={3}>
            <Btn onClick={chooseShot}>Shot</Btn>
            <Btn onClick={chooseTurnover}>Turnover</Btn>
            <Btn
              subtitle={team === "us" ? "Still our ball" : "Still their ball"}
              onClick={() => { pushHistory(); setStep("oob_reclassify"); }}
            >
              Foul/Jump/OOB
            </Btn>
          </Grid>
          {team === "us" && (
            <div style={{ marginTop: 8 }}>
              <HalfCourtButtons onChoose={chooseHalfCourtType} />
            </div>
          )}
        </Section>
      )}

      {step === "quick_shot" && (
        <Section label="Shot">
          <Grid cols={4}>
            <Btn onClick={() => selectShot(2, true)}>Make 2</Btn>
            <Btn onClick={() => selectShot(2, false)}>Miss 2</Btn>
            <Btn onClick={() => selectShot(3, true)}>Make 3</Btn>
            <Btn onClick={() => selectShot(3, false)}>Miss 3</Btn>
          </Grid>
          <Grid cols={3} style={{ marginTop: 8 }}>
            <Btn onClick={() => { pushHistory(); setStep("ft_attempts"); }}>FT trip</Btn>
            <Btn onClick={() => { pushHistory(); setStep("and1_shot"); }}>And-1</Btn>
            <Btn onClick={undo} style={{ color: "var(--muted)" }}>Undo</Btn>
          </Grid>
        </Section>
      )}

      {step === "flags" && (() => {
        const isDirectBlobSlob = (possessionType === "blob" || possessionType === "slob") && !orebOccurred;
        const showPaintTouch = possessionType !== "transition" && !isDirectBlobSlob;
        return (
          <>
            {showPaintTouch && (
              <Grid cols={2}>
                <Btn active={paintTouch} onClick={() => setPaintTouch((v) => !v)}>
                  Paint touch
                </Btn>
                <Btn active={paintTouchBoth} onClick={() => setPaintTouchBoth((v) => !v)}>
                  Both sides
                </Btn>
              </Grid>
            )}
            <Grid cols={4} style={{ marginTop: showPaintTouch ? 8 : 0 }}>
              <Btn onClick={() => selectShot(2, true)}>Make 2</Btn>
              <Btn onClick={() => selectShot(2, false)}>Miss 2</Btn>
              <Btn onClick={() => selectShot(3, true)}>Make 3</Btn>
              <Btn onClick={() => selectShot(3, false)}>Miss 3</Btn>
            </Grid>
            <Grid cols={4} style={{ marginTop: 8 }}>
              <Btn
                subtitle={team === "us" ? "Still our ball" : "Still their ball"}
                onClick={() => { pushHistory(); setStep("oob_reclassify"); }}
              >
                Foul/Jump/OOB
              </Btn>
              <Btn onClick={() => { pushHistory(); setStep("turnover_type"); }}>Turnover</Btn>
              <Btn onClick={() => { pushHistory(); setStep("ft_attempts"); }}>FT trip</Btn>
              <Btn onClick={() => { pushHistory(); setStep("and1_shot"); }}>And-1</Btn>
            </Grid>
            <Grid cols={1} style={{ marginTop: 8 }}>
              <Btn onClick={undo} style={{ color: "var(--muted)" }}>Undo</Btn>
            </Grid>
          </>
        );
      })()}

      {step === "oob_reclassify" && (
        <Section label="Inbounding from" accent>
          <Grid cols={2}>
            <Btn
              onClick={() => {
                pushHistory();
                setPossessionType("blob");
                setHalfCourtType(null);
                setPlayCallId(null);
                setDefenseScheme(null);
                setStep("oob_result");
              }}
            >
              BLOB
            </Btn>
            <Btn
              onClick={() => {
                pushHistory();
                setPossessionType("slob");
                setHalfCourtType(null);
                setPlayCallId(null);
                setDefenseScheme(null);
                setStep("oob_result");
              }}
            >
              SLOB
            </Btn>
          </Grid>
        </Section>
      )}

      {step === "turnover_type" && (
        <Section label="Turnover type">
          <Grid cols={2}>
            <Btn onClick={() => commit("turnover", { turnover_type: "live" })}>Live ball</Btn>
            <Btn onClick={() => commit("turnover", { turnover_type: "dead" })}>Dead ball</Btn>
            <Btn onClick={() => commit("turnover", { turnover_type: "charge" })}>Charge</Btn>
          </Grid>
        </Section>
      )}

      {step === "shot_quality" && (
        <Section label={team === "us" ? "Shot quality (last attempt)" : "Shot allowed (last attempt)"}>
          <Grid cols={4}>
            <Btn tone="success" subtitle="Layups & Free-throws" onClick={() => commitPendingShot("great")}>Great</Btn>
            <Btn tone="success" subtitle="Open, Catch & Shoot " onClick={() => commitPendingShot("good")}>Good</Btn>
            <Btn tone="warning" subtitle="Player specific & Shot clock" onClick={() => commitPendingShot("live")}>Live</Btn>
            <Btn tone="danger" subtitle="Contested & Early" onClick={() => commitPendingShot("tough")}>Tough</Btn>
          </Grid>
        </Section>
      )}

      {step === "and1_shot" && (
        <Section label="And-1 -- which shot?" accent>
          <Grid cols={2}>
            <Btn onClick={() => selectAnd1Shot(2)}>Make 2</Btn>
            <Btn onClick={() => selectAnd1Shot(3)}>Make 3</Btn>
          </Grid>
        </Section>
      )}

      {step === "and1_ft" && pendingShot && (
        <Section label="Bonus free throw" accent>
          <Grid cols={2}>
            <Btn
              tone="success"
              onClick={() =>
                commit("fg_made", {
                  shot_type: pendingShot.shotType,
                  points: pendingShot.shotType + 1,
                  shot_quality: "great",
                  absorbed_ft_attempts: 1,
                  absorbed_ft_made: 1,
                })
              }
            >
              Made
            </Btn>
            <Btn
              onClick={() =>
                commit("fg_made", {
                  shot_type: pendingShot.shotType,
                  points: pendingShot.shotType,
                  shot_quality: "great",
                  absorbed_ft_attempts: 1,
                  absorbed_ft_made: 0,
                })
              }
            >
              Missed
            </Btn>
          </Grid>
        </Section>
      )}

      {step === "oreb_check" && (
        <Section label={`Offensive rebound? (${pendingCommit?.label ?? ""})`} accent>
          <Grid cols={2}>
            <Btn tone="success" onClick={confirmOreb}>Yes</Btn>
            <Btn onClick={declineOreb}>No</Btn>
          </Grid>
        </Section>
      )}

      {step === "ft_attempts" && (
        <Section label="How many shots">
          <Grid cols={3}>
            {[1, 2, 3].map((n) => (
              <Btn key={n} onClick={() => { pushHistory(); setFtAttempts(n as 1 | 2 | 3); setStep("ft_points"); }}>{n}</Btn>
            ))}
          </Grid>
        </Section>
      )}

      {step === "ft_points" && ftAttempts != null && (
        <Section label={`Points made (of ${ftAttempts})`}>
          <Grid cols={ftAttempts + 1}>
            {Array.from({ length: ftAttempts + 1 }, (_, n) => n).map((n) => {
              const extra: Partial<Possession> = { points: n, ft_attempts: ftAttempts, shot_quality: "great" };
              const missed = n < ftAttempts;
              return (
                <Btn
                  key={n}
                  onClick={() => {
                    // A technical or flagrant free throw is a dead ball --
                    // nobody rebounds it, the ball is awarded. Only an
                    // end-of-game trip can stay alive and convert into a
                    // real possession off the glass.
                    const deadBall = ftAwardType === "technical" || ftAwardType === "flagrant";
                    if (!missed || deadBall) {
                      commit("ft_trip", extra);
                    } else {
                      pushHistory();
                      setPendingCommit({ outcome: "ft_trip", extra, isFgMiss: false, label: "missed FT" });
                      setStep("oreb_check");
                    }
                  }}
                >
                  {n}
                </Btn>
              );
            })}
          </Grid>
        </Section>
      )}
    </div>
  );
}

/**
 * The four half-court structures, rendered identically wherever a trip can
 * turn into a half-court look -- one component so the BLOB/SLOB flow, the
 * post-rebound flow and the press break flow can't drift apart.
 *
 * "Man set" and "Zone set" both pick from their own play list; the choice
 * is also what records which defense we were attacking. "Unscripted" is
 * the trip with no called structure and skips the play list.
 */
function HalfCourtButtons({ onChoose }: { onChoose: (type: HalfCourtType) => void }) {
  return (
    <Grid cols={4}>
      <Btn onClick={() => onChoose("set")}>Man set</Btn>
      <Btn onClick={() => onChoose("motion")}>Motion</Btn>
      <Btn onClick={() => onChoose("zone")}>Zone set</Btn>
      <Btn subtitle="No call" onClick={() => onChoose("unscripted")}>Unscripted</Btn>
    </Grid>
  );
}

function Section({ label, accent, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: accent ? 10 : 0,
        borderRadius: 8,
        background: accent ? "rgba(37,80,212,0.12)" : "transparent",
        border: accent ? "1px solid var(--royal-light)" : "none",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Grid({ cols, children, style }: { cols: number; children: React.ReactNode; style?: React.CSSProperties }) {
  const mobileCols = cols > 2 ? 2 : cols;
  return (
    <div
      className="gt-grid"
      style={{ ["--cols" as any]: cols, ["--cols-mobile" as any]: mobileCols, ...style }}
    >
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  active,
  tone,
  subtitle,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  tone?: "success" | "warning" | "danger";
  subtitle?: string;
  style?: React.CSSProperties;
}) {
  const toneColors: Record<string, string> = {
    success: "#1f7a4d",
    warning: "#8a6512",
    danger: "#8a2f2f",
  };
  return (
    <button
      onClick={onClick}
      style={{
        padding: "12px 8px",
        fontSize: 14,
        borderRadius: 8,
        border: `1px solid ${active ? "var(--royal-light)" : "var(--border)"}`,
        background: active ? "var(--royal)" : tone ? toneColors[tone] + "22" : "var(--surface2)",
        color: tone ? toneColors[tone] : "var(--text)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        ...style,
      }}
    >
      <span>{children}</span>
      {subtitle && <span style={{ fontSize: 10, opacity: 0.85, fontWeight: 400 }}>{subtitle}</span>}
    </button>
  );
}

function PlayCallPicker({
  plays,
  drawn,
  selectedId,
  onPick,
  onPickDrawn,
  onRename,
  adding,
  onStartAdd,
  newName,
  onNewName,
  onSaveNew,
}: {
  plays: PlayCall[];
  drawn: DrawnPlay[];
  selectedId?: string | null;
  onPick: (id: string) => void;
  onPickDrawn: (play: DrawnPlay) => void;
  onRename?: (pc: PlayCall) => void;
  adding: boolean;
  onStartAdd: () => void;
  newName: string;
  onNewName: (v: string) => void;
  onSaveNew: () => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {plays.map((p) => {
        const active = p.id === selectedId;
        return (
          <div key={p.id} style={{ display: "inline-flex", alignItems: "center", borderRadius: 20, overflow: "hidden", border: active ? "2px solid var(--gold)" : "1px solid var(--border)" }}>
            <button
              onClick={() => onPick(p.id)}
              style={{
                padding: "10px 16px", fontSize: 14, border: "none", cursor: "pointer",
                background: active ? "rgba(240,192,64,0.15)" : "var(--surface2)",
                color: "var(--text)", fontWeight: active ? 700 : 400,
              }}
            >
              {active ? "✓ " : ""}{p.name}
            </button>
            {onRename && (
              <button
                onClick={(e) => { e.stopPropagation(); onRename(p); }}
                title="Rename this play"
                style={{ padding: "10px 10px", fontSize: 13, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer", background: active ? "rgba(240,192,64,0.15)" : "var(--surface2)", color: "var(--muted)" }}
              >
                ✎
              </button>
            )}
          </div>
        );
      })}
      {drawn.map((dp) => (
        <button
          key={dp.id}
          onClick={() => onPickDrawn(dp)}
          title="From your drawn Plays"
          style={{ padding: "10px 16px", fontSize: 14, borderRadius: 20, border: "1px solid var(--royal-light)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer" }}
        >
          🏀 {dp.title}
        </button>
      ))}
      {adding ? (
        <span style={{ display: "flex", gap: 6 }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => onNewName(e.target.value)}
            placeholder="Play name"
            style={{ padding: "8px 10px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
          />
          <button onClick={onSaveNew} style={{ padding: "8px 14px", borderRadius: 20, border: "1px solid var(--royal-light)", background: "var(--royal)", color: "#fff", cursor: "pointer" }}>
            Save
          </button>
        </span>
      ) : (
        <button
          onClick={onStartAdd}
          style={{ padding: "10px 16px", fontSize: 14, borderRadius: 20, border: "1px dashed var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}
        >
          + Add play
        </button>
      )}
    </div>
  );
}
