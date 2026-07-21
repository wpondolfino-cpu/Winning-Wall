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
// BLOB/SLOB/Set/Motion pickers also surface any play drawn in the Plays
// feature and tagged with that category (case-insensitive), not just
// play_calls added inline here -- see gameStats.ts's fetchDrawnPlaysForCategory.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  queuePossession,
  queueCount,
  getLastSyncErrors,
  fetchDrawnPlaysForCategory,
  ensurePlayCallForPlay,
  type Possession,
  type PlayCall,
  type PlayCallCategory,
  type DrawnPlay,
  type Team,
  type PossessionType,
  type HalfCourtType,
  type OobResult,
  type Outcome,
} from "../../lib/gameStats";

interface Props {
  gameId: string;
  userId: string;
  quarter: number;
}

type Step =
  | "type"
  | "halfcourt_type"
  | "play_call"
  | "oob_result"
  | "action_branch"
  | "quick_shot"
  | "flags"
  | "turnover_type"
  | "shot_quality"
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

export default function GameTracker({ gameId, userId, quarter }: Props) {
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [drawnPlays, setDrawnPlays] = useState<Record<PlayCallCategory, DrawnPlay[]>>({ set: [], motion: [], blob: [], slob: [] });
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
    setPlayCalls((data as PlayCall[]) ?? []);
    const categories: PlayCallCategory[] = ["set", "motion", "blob", "slob"];
    const results = await Promise.all(categories.map((c) => fetchDrawnPlaysForCategory(c)));
    setDrawnPlays({ set: results[0], motion: results[1], blob: results[2], slob: results[3] });
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
        step, possessionType, halfCourtType, playCallId, oobResult, paintTouch, paintTouchBoth,
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
    setTeam((t) => (t === "us" ? "opponent" : "us"));
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

  /** Shared by every Make/Miss button (flags screen and quick_shot screen).
      We don't track shot quality for the opponent -- it's our own shot
      selection we're coaching, not theirs -- so a defensive miss skips
      straight to the OREB question with no quality step. */
  function selectShot(shotType: 2 | 3, made: boolean) {
    pushHistory();
    if (made) {
      if (team === "opponent") {
        commit("fg_made", { shot_type: shotType, points: shotType, shot_quality: null });
      } else {
        setPendingShot({ shotType, made: true });
        setStep("shot_quality");
      }
    } else if (team === "opponent") {
      setPendingCommit({
        outcome: "fg_missed",
        extra: { shot_type: shotType, points: 0, shot_quality: null },
        isFgMiss: true,
        label: `missed ${shotType}`,
      });
      setStep("oreb_check");
    } else {
      setPendingShot({ shotType, made: false });
      setStep("shot_quality");
    }
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
    if (possessionType !== "blob" && possessionType !== "slob") {
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
    setLog((l) => l.slice(0, -1));
    setSequence((s) => Math.max(1, s - 1));
    setTeam((t) => (t === "us" ? "opponent" : "us"));
    // Local-log undo only -- once a possession has synced, correcting it
    // is an edit on the report screen, not a live undo.
  }

  async function addPlayCall(category: PlayCallCategory) {
    if (!newPlayName.trim()) return;
    const { data, error } = await supabase
      .from("play_calls")
      .insert({ category, name: newPlayName.trim(), created_by: userId })
      .select()
      .single();
    if (!error && data) {
      pushHistory();
      setPlayCalls((p) => [...p, data as PlayCall]);
      setPlayCallId((data as PlayCall).id);
      setNewPlayName("");
      setAddingPlayFor(null);
      setStep(possessionType === "half_court" ? "flags" : "oob_result");
    }
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

  /** Set/Motion buttons shared by both action_branch (post-OREB / post-BLOB-SLOB) entry points. */
  function chooseSetOrMotion(type: HalfCourtType) {
    pushHistory();
    if (possessionType === "blob" || possessionType === "slob") setOobResult("flowed_half_court");
    setHalfCourtType(type);
    setStep("play_call");
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
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Q{quarter} · Possession {sequence}</span>
        <span
          style={{ fontSize: 12, color: syncErrorCount ? "#c2402f" : unsynced ? "#e0a530" : "var(--muted)", cursor: syncErrorCount ? "pointer" : "default" }}
          onClick={syncErrorCount ? showSyncErrors : undefined}
        >
          {syncErrorCount ? `⚠ ${syncErrorCount} failed to sync (tap for details)` : unsynced ? `${unsynced} unsynced` : "synced"}
        </span>
      </div>

      <div className="role-tabs">
        <button className={`role-tab ${team === "us" ? "active" : ""}`} onClick={() => setTeam("us")}>
          Us on offense
        </button>
        <button
          className={`role-tab ${team === "opponent" ? "active" : ""}`}
          onClick={() => setTeam("opponent")}
          style={team === "opponent" ? { background: DEFENSE_ACCENT, borderColor: DEFENSE_ACCENT } : undefined}
        >
          Us on defense
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

      {step === "type" && (
        <Section label="Possession type">
          <Grid cols={4}>
            <Btn onClick={() => { pushHistory(); setPossessionType("transition"); setStep("flags"); }}>Transition</Btn>
            <Btn
              onClick={() => {
                pushHistory();
                setPossessionType("half_court");
                setOrebOccurred(false);
                // On defense we don't know the opponent's called set, so
                // skip straight past Set/Motion/play-call to the outcome.
                setStep(team === "opponent" ? "flags" : "halfcourt_type");
              }}
            >
              Half-court
            </Btn>
            <Btn onClick={() => { pushHistory(); setPossessionType("blob"); setStep("oob_result"); }}>BLOB</Btn>
            <Btn onClick={() => { pushHistory(); setPossessionType("slob"); setStep("oob_result"); }}>SLOB</Btn>
          </Grid>
        </Section>
      )}

      {step === "halfcourt_type" && (
        <Section label="Half-court type" accent>
          <Grid cols={2}>
            <Btn onClick={() => { pushHistory(); setHalfCourtType("set"); setStep("play_call"); }}>Set</Btn>
            <Btn onClick={() => { pushHistory(); setHalfCourtType("motion"); setStep("play_call"); }}>Motion</Btn>
          </Grid>
        </Section>
      )}

      {step === "play_call" && halfCourtType && (
        <Section label={`Which ${halfCourtType}`} accent>
          <PlayCallPicker
            plays={playsForCategory(halfCourtType)}
            drawn={unlinkedDrawnFor(halfCourtType)}
            onPick={(id) => { pushHistory(); setPlayCallId(id); setStep("flags"); }}
            onPickDrawn={(dp) => pickDrawnPlay(dp, halfCourtType, "flags")}
            adding={addingPlayFor === halfCourtType}
            onStartAdd={() => setAddingPlayFor(halfCourtType)}
            newName={newPlayName}
            onNewName={setNewPlayName}
            onSaveNew={() => addPlayCall(halfCourtType)}
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
                onPick={(id) => setPlayCallId(id)}
                onPickDrawn={(dp) => pickDrawnPlay(dp, possessionType, "oob_result")}
                adding={addingPlayFor === possessionType}
                onStartAdd={() => setAddingPlayFor(possessionType)}
                newName={newPlayName}
                onNewName={setNewPlayName}
                onSaveNew={() => addPlayCall(possessionType)}
              />
            </Section>
          )}
          <Section label="What happened" accent>
            <Grid cols={team === "us" ? 4 : 2}>
              <Btn onClick={chooseShot}>Shot</Btn>
              <Btn onClick={chooseTurnover}>Turnover</Btn>
              {team === "us" && <Btn onClick={() => chooseSetOrMotion("set")}>Set</Btn>}
              {team === "us" && <Btn onClick={() => chooseSetOrMotion("motion")}>Motion</Btn>}
            </Grid>
          </Section>
        </>
      )}

      {step === "action_branch" && (
        <Section label="What happened">
          <Grid cols={team === "us" ? 4 : 2}>
            <Btn onClick={chooseShot}>Shot</Btn>
            <Btn onClick={chooseTurnover}>Turnover</Btn>
            {team === "us" && <Btn onClick={() => chooseSetOrMotion("set")}>Set</Btn>}
            {team === "us" && <Btn onClick={() => chooseSetOrMotion("motion")}>Motion</Btn>}
          </Grid>
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
          <Grid cols={2} style={{ marginTop: 8 }}>
            <Btn onClick={() => { pushHistory(); setStep("ft_attempts"); }}>FT trip</Btn>
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
            <Grid cols={3} style={{ marginTop: 8 }}>
              <Btn onClick={() => { pushHistory(); setStep("turnover_type"); }}>Turnover</Btn>
            <Btn onClick={() => { pushHistory(); setStep("ft_attempts"); }}>FT trip</Btn>
            <Btn onClick={undo} style={{ color: "var(--muted)" }}>Undo</Btn>
          </Grid>
          </>
        );
      })()}

      {step === "turnover_type" && (
        <Section label="Turnover type">
          <Grid cols={2}>
            <Btn onClick={() => commit("turnover", { turnover_type: "live" })}>Live ball</Btn>
            <Btn onClick={() => commit("turnover", { turnover_type: "dead" })}>Dead ball</Btn>
          </Grid>
        </Section>
      )}

      {step === "shot_quality" && (
        <Section label="Shot quality (last attempt)">
          <Grid cols={4}>
            <Btn tone="success" onClick={() => commitPendingShot("great")}>Great</Btn>
            <Btn tone="success" onClick={() => commitPendingShot("good")}>Good</Btn>
            <Btn tone="warning" onClick={() => commitPendingShot("live")}>Live</Btn>
            <Btn tone="danger" onClick={() => commitPendingShot("tough")}>Tough</Btn>
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
              const extra: Partial<Possession> = { points: n, ft_attempts: ftAttempts, shot_quality: team === "us" ? "great" : null };
              const missed = n < ftAttempts;
              return (
                <Btn
                  key={n}
                  onClick={() => {
                    if (!missed) {
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
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  tone?: "success" | "warning" | "danger";
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
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function PlayCallPicker({
  plays,
  drawn,
  onPick,
  onPickDrawn,
  adding,
  onStartAdd,
  newName,
  onNewName,
  onSaveNew,
}: {
  plays: PlayCall[];
  drawn: DrawnPlay[];
  onPick: (id: string) => void;
  onPickDrawn: (play: DrawnPlay) => void;
  adding: boolean;
  onStartAdd: () => void;
  newName: string;
  onNewName: (v: string) => void;
  onSaveNew: () => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {plays.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p.id)}
          style={{ padding: "10px 16px", fontSize: 14, borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer" }}
        >
          {p.name}
        </button>
      ))}
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
