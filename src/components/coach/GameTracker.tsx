// src/components/coach/GameTracker.tsx
// Live, offline-first possession entry. Every tap queues locally via
// gameStats.queuePossession and syncs in the background -- the coach never
// waits on the network mid-game. One possession = one true offensive trip;
// an OREB extends the current trip (increments oreb_count) instead of
// starting a new one, but jumps straight into a fresh half-court sub-flow
// so the follow-up action gets its own play-call/paint-touch/shot-quality
// detail, same as if "Half-court" had been tapped from scratch.
//
// The team toggle (us on offense / us on defense) auto-flips after every
// committed possession, since basketball possessions alternate -- undo
// reverts the flip along with the possession it's undoing.
//
// Shot quality applies to both makes and misses on OUR possessions (it
// rates the look, not the result) and every FG attempt routes through a
// "pendingShot" holding pattern before being committed with a quality tag.
// On defense we skip shot quality and play-calling (Set/Motion/BLOB/SLOB
// picker) entirely -- we're coaching our own shot selection, not judging
// theirs, and we don't know the name of a play we didn't call. FT trips
// are auto-tagged "great" quality, but only on our own trips to the line.
//
// BLOB/SLOB/Set/Motion pickers also surface any play drawn in the Plays
// feature and tagged with that category (case-insensitive), not just
// play_calls added inline here -- see gameStats.ts's fetchDrawnPlaysForCategory.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  queuePossession,
  queueCount,
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
  type PaintTouch,
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
  | "flags"
  | "turnover_type"
  | "shot_type"
  | "shot_quality"
  | "ft_points";

interface PendingShot {
  shotType: 2 | 3;
  made: boolean;
}

interface FlowSnapshot {
  step: Step;
  possessionType: PossessionType | null;
  halfCourtType: HalfCourtType | null;
  playCallId: string | null;
  oobResult: OobResult | null;
  paintTouch: PaintTouch | null;
  orebCount: number;
  pendingShot: PendingShot | null;
  postOreb: boolean;
}

export default function GameTracker({ gameId, userId, quarter }: Props) {
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [drawnPlays, setDrawnPlays] = useState<Record<PlayCallCategory, DrawnPlay[]>>({ set: [], motion: [], blob: [], slob: [] });
  const [unsynced, setUnsynced] = useState(0);
  const [sequence, setSequence] = useState(1);
  const [log, setLog] = useState<Possession[]>([]);

  const [team, setTeam] = useState<Team>("us");
  const [step, setStep] = useState<Step>("type");
  const [possessionType, setPossessionType] = useState<PossessionType | null>(null);
  const [halfCourtType, setHalfCourtType] = useState<HalfCourtType | null>(null);
  const [playCallId, setPlayCallId] = useState<string | null>(null);
  const [oobResult, setOobResult] = useState<OobResult | null>(null);
  const [paintTouch, setPaintTouch] = useState<PaintTouch | null>(null);
  const [orebCount, setOrebCount] = useState(0);
  const [pendingShot, setPendingShot] = useState<PendingShot | null>(null);
  const [postOreb, setPostOreb] = useState(false);
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
  }

  function resetForNextPossession() {
    setStep("type");
    setPossessionType(null);
    setHalfCourtType(null);
    setPlayCallId(null);
    setOobResult(null);
    setPaintTouch(null);
    setOrebCount(0);
    setPendingShot(null);
    setPostOreb(false);
    setHistory([]);
  }

  /** Snapshots the current flow state before advancing a step, so goBack can restore it exactly. */
  function pushHistory() {
    setHistory((h) => [
      ...h,
      { step, possessionType, halfCourtType, playCallId, oobResult, paintTouch, orebCount, pendingShot, postOreb },
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
      setOrebCount(prev.orebCount);
      setPendingShot(prev.pendingShot);
      setPostOreb(prev.postOreb);
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
      oreb_count: orebCount,
      outcome,
      shot_type: null,
      shot_quality: null,
      turnover_type: null,
      points: 0,
      created_by: userId,
      created_at: new Date().toISOString(),
      ...extra,
    };
    await queuePossession(possession);
    setLog((l) => [...l, possession]);
    setSequence((s) => s + 1);
    refreshUnsynced();
    setTeam((t) => (t === "us" ? "opponent" : "us"));
    resetForNextPossession();
  }

  function commitPendingShot(quality: "great" | "good" | "live" | "tough") {
    if (!pendingShot) return;
    commit(pendingShot.made ? "fg_made" : "fg_missed", {
      shot_type: pendingShot.shotType,
      points: pendingShot.made ? pendingShot.shotType : 0,
      shot_quality: quality,
    });
  }

  /** Shared by the Make/Miss buttons and the BLOB/SLOB score branch. We don't
      track shot quality for the opponent -- it's our own shot selection we're
      coaching, not theirs -- so a defensive attempt commits immediately. */
  function selectShot(shotType: 2 | 3, made: boolean) {
    pushHistory();
    if (team === "opponent") {
      commit(made ? "fg_made" : "fg_missed", { shot_type: shotType, points: made ? shotType : 0, shot_quality: null });
    } else {
      setPendingShot({ shotType, made });
      setStep("shot_quality");
    }
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

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <style>{`
        .gt-grid { display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: 8px; }
        @media (max-width: 480px) {
          .gt-grid { grid-template-columns: repeat(var(--cols-mobile), 1fr); }
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Q{quarter} · Possession {sequence}</span>
        <span style={{ fontSize: 12, color: unsynced ? "#e0a530" : "var(--muted)" }}>
          {unsynced ? `${unsynced} unsynced` : "synced"}
        </span>
      </div>

      <div className="role-tabs">
        <button className={`role-tab ${team === "us" ? "active" : ""}`} onClick={() => setTeam("us")}>
          Us on offense
        </button>
        <button className={`role-tab ${team === "opponent" ? "active" : ""}`} onClick={() => setTeam("opponent")}>
          Us on defense
        </button>
      </div>

      {history.length > 0 && (
        <button
          onClick={goBack}
          style={{ marginBottom: 10, padding: "6px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", cursor: "pointer" }}
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
                setPostOreb(false);
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
          <Grid cols={postOreb ? 3 : 2}>
            <Btn onClick={() => { pushHistory(); setHalfCourtType("set"); setStep("play_call"); }}>Set</Btn>
            <Btn onClick={() => { pushHistory(); setHalfCourtType("motion"); setStep("play_call"); }}>Motion</Btn>
            {postOreb && (
              <Btn onClick={() => { pushHistory(); setHalfCourtType(null); setPlayCallId(null); setStep("flags"); }}>
                Immediate score
              </Btn>
            )}
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
          <Section label="Result" accent>
            <Grid cols={2}>
              <Btn onClick={() => { pushHistory(); setOobResult("score"); setStep("shot_type"); }}>Score</Btn>
              <Btn onClick={() => { pushHistory(); setOobResult("flowed_half_court"); setStep("flags"); }}>Flowed to half-court</Btn>
            </Grid>
          </Section>
        </>
      )}

      {step === "flags" && (
        <>
          {!postOreb && possessionType !== "transition" && (
            <Grid cols={2}>
              <Btn active={paintTouch === "single"} onClick={() => setPaintTouch(paintTouch === "single" ? null : "single")}>
                Paint touch
              </Btn>
              <Btn active={paintTouch === "both"} onClick={() => setPaintTouch(paintTouch === "both" ? null : "both")}>
                Both sides
              </Btn>
            </Grid>
          )}
          <Grid cols={4} style={{ marginTop: postOreb || possessionType === "transition" ? 0 : 8 }}>
            <Btn onClick={() => selectShot(2, true)}>Make 2</Btn>
            <Btn onClick={() => selectShot(2, false)}>Miss 2</Btn>
            <Btn onClick={() => selectShot(3, true)}>Make 3</Btn>
            <Btn onClick={() => selectShot(3, false)}>Miss 3</Btn>
          </Grid>
          <Grid cols={4} style={{ marginTop: 8 }}>
            <Btn
              onClick={() => {
                // An offensive rebound doesn't end the trip -- it keeps the
                // same possession alive and hands it straight into a fresh
                // half-court look, same as tapping "Half-court" from scratch.
                // On defense (their OREB) we still don't know their set, so
                // skip straight to the outcome instead of Set/Motion.
                pushHistory();
                setOrebCount((c) => c + 1);
                setPossessionType("half_court");
                setHalfCourtType(null);
                setPlayCallId(null);
                setPaintTouch(null);
                setPostOreb(true);
                setStep(team === "opponent" ? "flags" : "halfcourt_type");
              }}
            >
              OREB {orebCount ? `(${orebCount})` : ""}
            </Btn>
            <Btn onClick={() => { pushHistory(); setStep("turnover_type"); }}>Turnover</Btn>
            <Btn onClick={() => { pushHistory(); setStep("ft_points"); }}>FT trip</Btn>
            <Btn onClick={undo} style={{ color: "var(--muted)" }}>Undo</Btn>
          </Grid>
        </>
      )}

      {step === "turnover_type" && (
        <Section label="Turnover type">
          <Grid cols={2}>
            <Btn onClick={() => commit("turnover", { turnover_type: "live" })}>Live ball</Btn>
            <Btn onClick={() => commit("turnover", { turnover_type: "dead" })}>Dead ball</Btn>
          </Grid>
        </Section>
      )}

      {step === "shot_type" && (
        <Section label="Shot type (BLOB/SLOB score)">
          <Grid cols={2}>
            <Btn onClick={() => selectShot(2, true)}>2 pointer</Btn>
            <Btn onClick={() => selectShot(3, true)}>3 pointer</Btn>
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

      {step === "ft_points" && (
        <Section label="Points made at the line">
          <Grid cols={4}>
            {[0, 1, 2, 3].map((n) => (
              <Btn key={n} onClick={() => commit("ft_trip", { points: n, shot_quality: team === "us" ? "great" : null })}>{n}</Btn>
            ))}
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
