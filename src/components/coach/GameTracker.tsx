// src/components/coach/GameTracker.tsx
// Live, offline-first possession entry. Every tap queues locally via
// gameStats.queuePossession and syncs in the background -- the coach never
// waits on the network mid-game. One possession = one true offensive trip;
// an OREB extends the current trip (increments oreb_count) instead of
// starting a new one.
//
// LOOKS (migration 134). A trip is recorded as one or more looks, each
// with its own type, structure, play call, paint touch, result and points
// (see the Looks note in gameStats.ts). The current look lives in the
// flow state below; `looks` holds the ones already finished in this trip.
// A look ends and the next begins when:
//   - an offensive rebound keeps the trip alive   (ends "rebounded")
//   - a BLOB/SLOB flows into a half-court set     (ends "flowed")
//   - a press break turns into transition/half court, or our press on
//     defence falls back into man/zone            (ends "broke_press"/"flowed")
//   - a foul/jump/OOB makes it a BLOB/SLOB        (ends "reset")
// commit() adds the final look and writes the row through summarizeLooks,
// so the trip's counters (oreb_count, missed_fg_count, absorbed FTs, ...)
// always agree with its looks.
//
// OREB is no longer a standalone button -- a missed shot (or a missed free
// throw) is a "pendingCommit" that doesn't save yet; instead it asks
// "Offensive rebound?" on both ends, after shot quality has been graded.
// No commits the miss as the trip's final result. Yes closes the look as
// "rebounded" -- keeping its shot type, grade and any free throws made --
// and opens a putback look of the same type (a putback off a transition
// miss is still transition), then routes into action_branch. Picking a
// half-court structure there turns the putback into a normal half-court
// look instead. A rebounded press break or awarded free throw becomes a
// half-court look; the latter is how an end-of-game trip converts into a
// real possession.
//
// A missed free throw asks the same Yes/No question. OREB% leaves free
// throws out on both sides -- telling a missed LAST free throw from a
// missed first one would cost an extra tap -- so a rebounded free throw
// keeps the trip alive and counts toward second chance points and extra
// possessions, but not toward the rebounding percentage.
//
// action_branch: Shot / Turnover / Foul-Jump-OOB / (the four half-court
// structures, us only). Shot skips straight to a reduced outcome grid.
// Paint touch/both sides are asked on half-court looks that set up --
// never on a putback, a transition look or an inbounds look.
//
// The team toggle (us on offense / us on defense) auto-flips after every
// committed possession, since basketball possessions alternate -- undo
// reverts the flip along with the possession it's undoing. On defense we
// skip play-calling (Set/Motion/BLOB/SLOB picker) entirely -- we don't
// know the name of a play we didn't call -- but shot quality IS graded,
// as the shot we allowed. FT trips ask
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
// while press_result keeps track of what the press itself turned into for
// press effectiveness specifically. The options mirror the offence's press
// break: a turnover we forced, man or zone once they broke it, transition
// if they got out on us, a foul/jump/OOB that makes it their inbounds, or
// a trip to the line. Man, zone and transition end the press look and
// start a look of that type; the rest stay on the press look.
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
// then what it turned into. Transition and half-court end the press look
// and start a look of that type, so those points land in the transition
// and half-court numbers. The trip stays a press break trip either way.
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
// asks the rebound question; saying yes starts a half-court look, which IS
// the conversion into a real possession. Technicals
// and flagrants also don't flip the team toggle, since the ball can go
// either way and guessing wrong misattributes the next trip.

import { useEffect, useRef, useState } from "react";
import { registerNavGuard } from "../../lib/navGuard";
import { supabase } from "../../lib/supabase";
import {
  queuePossession,
  queueCount,
  getLastSyncErrors,
  fetchDrawnPlaysForCategory,
  ensurePlayCallForPlay,
  periodLabel,
  emptyLook,
  summarizeLooks,
  looksOf,
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
  type Look,
  type LookEnd,
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
  /** The result half of the look -- shot type, grade, free throws, points. */
  detail: Partial<Look>;
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
  looks: Look[];
  putback: boolean;
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
  // Looks already finished earlier in this trip, and whether the current
  // look is a putback (started by a rebound, nothing new picked yet).
  const [looks, setLooks] = useState<Look[]>([]);
  const [putback, setPutback] = useState(false);
  const [pendingShot, setPendingShot] = useState<PendingShot | null>(null);
  const [pendingCommit, setPendingCommit] = useState<PendingCommit | null>(null);
  const [orebOccurred, setOrebOccurred] = useState(false); // true once any OREB happens in this trip
  const [ftAttempts, setFtAttempts] = useState<1 | 2 | 3 | null>(null);
  const [newPlayName, setNewPlayName] = useState("");
  const [addingPlayFor, setAddingPlayFor] = useState<PlayCallCategory | null>(null);
  const [history, setHistory] = useState<FlowSnapshot[]>([]);

  // A possession only saves when its last tap is made, so anything past
  // the first screen lives in memory until then. Warn before a sidebar
  // tap, the Back button, a refresh or closing the page throws it away.
  // Finished possessions are already queued and aren't at risk.
  const possessionInProgress = step !== "type" || possessionType !== null;
  const possessionInProgressRef = useRef(possessionInProgress);
  possessionInProgressRef.current = possessionInProgress;

  useEffect(() => registerNavGuard(() =>
    possessionInProgressRef.current
      ? "You're partway through entering a possession. If you leave now, that possession won't be saved.\n\nLeave anyway?"
      : null
  ), []);

  useEffect(() => {
    if (!possessionInProgress) return;
    // Browsers show their own generic "Leave site?" text here; a custom
    // message isn't allowed.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [possessionInProgress]);

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
    setLooks([]);
    setPutback(false);
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
        looks, putback, pendingShot, pendingCommit, orebOccurred, ftAttempts,
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
      setLooks(prev.looks);
      setPutback(prev.putback);
      setPendingShot(prev.pendingShot);
      setPendingCommit(prev.pendingCommit);
      setOrebOccurred(prev.orebOccurred);
      setFtAttempts(prev.ftAttempts);
      return h.slice(0, -1);
    });
  }

  /** The look being tracked right now, from the flow state. */
  function currentLook(): Look {
    return {
      ...emptyLook(possessionType ?? "half_court"),
      half_court_type: halfCourtType,
      play_call_id: playCallId,
      putback,
      defense_scheme: defenseScheme,
      press_result: pressResult,
      press_break_type_id: pressBreakTypeId,
      press_break_result: pressBreakResult,
      oob_result: oobResult,
      oob_defense: oobDefense,
      paint_touch: paintTouch,
      paint_touch_both_sides: paintTouchBoth,
    };
  }

  /** Finishes the current look. `detail` carries anything picked in this same tap, before state has caught up. */
  function closeLook(end: LookEnd, detail: Partial<Look> = {}) {
    const finished: Look = { ...currentLook(), end, ...detail };
    setLooks((ls: Look[]) => [...ls, finished]);
  }

  /** Clears the flow state for the next look in the same trip. */
  function startNextLook(type: PossessionType, opts: { putback?: boolean; defenseScheme?: DefenseScheme | null } = {}) {
    setPossessionType(type);
    setHalfCourtType(null);
    setPlayCallId(null);
    setPutback(opts.putback ?? false);
    setDefenseScheme(opts.defenseScheme ?? null);
    setPressResult(null);
    setPressBreakTypeId(null);
    setPressBreakResult(null);
    setOobResult(null);
    setOobDefense(null);
    setPaintTouch(false);
    setPaintTouchBoth(false);
  }

  async function commit(outcome: Outcome, detail: Partial<Look> = {}) {
    const finalLook: Look = { ...currentLook(), end: "final", outcome, ...detail };
    const summary = summarizeLooks([...looks, finalLook]);
    const possession: Possession = {
      id: crypto.randomUUID(),
      game_id: gameId,
      team,
      quarter,
      sequence,
      ...summary,
      ft_award_type: ftAwardType,
      created_by: userId,
      created_at: new Date().toISOString(),
    };
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
        detail: { shot_type: pendingShot.shotType, points: 0, shot_quality: quality },
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

  /** "No" on the OREB question -- the pending miss (FG or FT) is the trip's final result. */
  function declineOreb() {
    if (pendingCommit) commit(pendingCommit.outcome, pendingCommit.detail);
    setPendingCommit(null);
  }

  /** "Yes" on the OREB question -- the trip stays alive. The look that
      missed is finished as "rebounded", keeping its shot type, grade and
      any free throws made, and a putback look begins. The putback keeps
      the type of the look it came from (a putback off a transition miss
      is still transition), except that a press break or awarded free
      throw becomes half court -- the latter is how an end-of-game trip
      converts into a real possession. Defence keeps the scheme it was in. */
  function confirmOreb() {
    if (!pendingCommit) return;
    pushHistory();
    const wasType = possessionType ?? "half_court";
    closeLook("rebounded", { outcome: pendingCommit.outcome, ...pendingCommit.detail });
    const nextType: PossessionType = wasType === "press_break" || wasType === "non_possession_ft" ? "half_court" : wasType;
    startNextLook(nextType, { putback: true, defenseScheme });
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

  /**
   * Archives a play call rather than deleting it.
   *
   * Past possessions link to this id, so a hard delete would either orphan
   * them or wipe the history behind a season's numbers. Archiving takes it
   * out of the picker and leaves every possession that used it intact --
   * the tracker already filters on status = 'active', so nothing else
   * needed changing.
   */
  async function archivePlayCall(pc: PlayCall) {
    const inUse = log.some((p) => looksOf(p).some((l) => l.play_call_id === pc.id || l.press_break_type_id === pc.id));
    const msg = inUse
      ? `Archive "${pc.name}"? It's been used in this game — those possessions keep it, it just won't show in the picker any more.`
      : `Archive "${pc.name}"? It disappears from the picker. Past games that used it are unaffected.`;
    if (!window.confirm(msg)) return;
    const { error } = await supabase.from("play_calls").update({ status: "archived" }).eq("id", pc.id);
    if (!error) setPlayCalls((list) => list.filter((p) => p.id !== pc.id));
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
    if (putback) {
      // Set up after a rebound: this look is a half-court look now, not a
      // putback -- which is also what turns a transition trip into a
      // half-court possession.
      setPossessionType("half_court");
      setPutback(false);
    } else if (possessionType === "blob" || possessionType === "slob") {
      // The inbounds look is over; the set is a look of its own.
      closeLook("flowed", { oob_result: "flowed_half_court" });
      startNextLook("half_court");
    }
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
    if (becomes) {
      // Broke it: the press look ends, and the transition or half-court
      // look it turned into begins.
      closeLook("broke_press", { press_break_result: result });
      startNextLook(becomes);
    } else {
      setPressBreakResult(result);
    }
    setStep(nextStep);
  }

  /** Foul/Jump/OOB: the trip becomes an inbounds play. */
  function reclassifyToOob(type: "blob" | "slob") {
    pushHistory();
    if (possessionType === "press_break") {
      closeLook("broke_press", { press_break_result: "oob" });
    } else if (possessionType === "press") {
      closeLook("broke_press", { press_result: "oob" });
    } else if (!putback) {
      closeLook("reset");
    }
    // An untouched putback look (fouled straight off the rebound) had
    // nothing happen in it, so it's replaced rather than recorded.
    startNextLook(type);
    setStep("oob_result");
  }

  /**
   * What our press on defence turned into -- the mirror of
   * choosePressBreakResult. Man/Zone and Transition end the press look and
   * start a look of that type (keeping the scheme we matched up in);
   * Turnover, a foul/jump/OOB and a trip to the line all stay on the press
   * look, since the press itself is what produced them.
   */
  function choosePressResult(result: PressResult, nextStep: Step, becomes?: PossessionType, scheme?: DefenseScheme) {
    pushHistory();
    if (becomes) {
      closeLook("flowed", { press_result: result });
      startNextLook(becomes, { defenseScheme: scheme ?? null });
    } else {
      setPressResult(result);
    }
    setStep(nextStep);
  }

  // A putback isn't an inbounds play, so it never gets an OOB result.
  const isInboundsLook = (possessionType === "blob" || possessionType === "slob") && !putback;

  function chooseShot() {
    pushHistory();
    if (isInboundsLook) setOobResult("direct_shot");
    setStep("quick_shot");
  }

  function chooseTurnover() {
    pushHistory();
    if (isInboundsLook) setOobResult("turnover");
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
            onArchive={archivePlayCall}
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
          <Grid cols={2} style={{ marginTop: 8 }}>
            <Btn subtitle="Still our ball" onClick={() => choosePressBreakResult("oob", "oob_reclassify")}>
              Foul/Jump/OOB
            </Btn>
            {/* No And-1 here: a shot only happens after this screen has already
                routed to transition or half court, so the And-1 button on those
                screens covers it. FT trip stays -- fouled in the backcourt while
                they're over the limit is a trip to the line straight off the
                break, with no transition or half-court phase in between. */}
            <Btn onClick={() => choosePressBreakResult("ft_trip", "ft_attempts")}>FT trip</Btn>
          </Grid>
        </Section>
      )}

      {step === "press_result" && (
        <Section label="What it turned into" accent>
          <Grid cols={3}>
            <Btn onClick={() => choosePressResult("turnover", "turnover_type")}>Turnover</Btn>
            <Btn onClick={() => choosePressResult("man", "flags", "half_court", "man")}>Man</Btn>
            <Btn onClick={() => choosePressResult("zone", "flags", "half_court", "zone")}>Zone</Btn>
          </Grid>
          <Grid cols={3} style={{ marginTop: 8 }}>
            <Btn subtitle="They got out" onClick={() => choosePressResult("transition", "flags", "transition")}>Transition</Btn>
            <Btn subtitle="Still their ball" onClick={() => choosePressResult("oob", "oob_reclassify")}>Foul/Jump/OOB</Btn>
            <Btn onClick={() => choosePressResult("ft_trip", "ft_attempts")}>FT trip</Btn>
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
            onArchive={archivePlayCall}
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
                onArchive={archivePlayCall}
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
        // Asked on half-court looks that set up -- not transition, not an
        // inbounds look, not a putback.
        const showPaintTouch = possessionType === "half_court" && !putback;
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
            <Btn onClick={() => reclassifyToOob("blob")}>BLOB</Btn>
            <Btn onClick={() => reclassifyToOob("slob")}>SLOB</Btn>
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
                  ft_attempts: 1,
                  ft_made: 1,
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
                  ft_attempts: 1,
                  ft_made: 0,
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
            <Btn tone="success" subtitle={team === "us" ? "We got it" : "They got it"} onClick={confirmOreb}>Yes</Btn>
            <Btn subtitle={team === "us" ? "They got it" : "We got it"} onClick={declineOreb}>No</Btn>
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
              const detail: Partial<Look> = { points: n, ft_attempts: ftAttempts, ft_made: n, shot_quality: "great" };
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
                      commit("ft_trip", detail);
                    } else {
                      pushHistory();
                      setPendingCommit({ outcome: "ft_trip", detail, label: "missed FT" });
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
  onArchive,
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
  onArchive?: (pc: PlayCall) => void;
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
            {onArchive && (
              <button
                onClick={(e) => { e.stopPropagation(); onArchive(p); }}
                title="Archive this play (hides it from the picker; past games keep it)"
                style={{ padding: "10px 10px", fontSize: 13, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer", background: active ? "rgba(240,192,64,0.15)" : "var(--surface2)", color: "var(--muted)" }}
              >
                ✕
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
