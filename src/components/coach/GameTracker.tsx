// src/components/coach/GameTracker.tsx
// Live, offline-first possession entry. Every tap queues locally via
// gameStats.queuePossession and syncs in the background -- the coach never
// waits on the network mid-game. One possession = one true offensive trip;
// an OREB extends the current trip instead of starting a new one.
//
// Shot quality applies to both makes and misses (it rates the look, not
// the result), so every FG attempt routes through a "pendingShot" holding
// pattern before it's committed with a quality tag.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  queuePossession,
  queueCount,
  type Possession,
  type PlayCall,
  type PlayCallCategory,
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

export default function GameTracker({ gameId, userId, quarter }: Props) {
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
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
  const [newPlayName, setNewPlayName] = useState("");
  const [addingPlayFor, setAddingPlayFor] = useState<PlayCallCategory | null>(null);

  useEffect(() => {
    loadPlayCalls();
    refreshUnsynced();
    const t = setInterval(refreshUnsynced, 4000);
    return () => clearInterval(t);
  }, []);

  async function loadPlayCalls() {
    const { data } = await supabase.from("play_calls").select("*").eq("status", "active");
    setPlayCalls((data as PlayCall[]) ?? []);
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

  function undo() {
    setLog((l) => l.slice(0, -1));
    setSequence((s) => Math.max(1, s - 1));
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
      setPlayCalls((p) => [...p, data as PlayCall]);
      setPlayCallId((data as PlayCall).id);
      setNewPlayName("");
      setAddingPlayFor(null);
      setStep(possessionType === "half_court" ? "flags" : "oob_result");
    }
  }

  const playsForCategory = (cat: PlayCallCategory) => playCalls.filter((p) => p.category === cat);

  return (
    <div className="card" style={{ maxWidth: 640 }}>
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

      {step === "type" && (
        <Section label="Possession type">
          <Grid cols={4}>
            <Btn onClick={() => { setPossessionType("transition"); setStep("flags"); }}>Transition</Btn>
            <Btn onClick={() => { setPossessionType("half_court"); setStep("halfcourt_type"); }}>Half-court</Btn>
            <Btn onClick={() => { setPossessionType("blob"); setStep("oob_result"); }}>BLOB</Btn>
            <Btn onClick={() => { setPossessionType("slob"); setStep("oob_result"); }}>SLOB</Btn>
          </Grid>
        </Section>
      )}

      {step === "halfcourt_type" && (
        <Section label="Half-court type" accent>
          <Grid cols={2}>
            <Btn onClick={() => { setHalfCourtType("set"); setStep("play_call"); }}>Set</Btn>
            <Btn onClick={() => { setHalfCourtType("motion"); setStep("play_call"); }}>Motion</Btn>
          </Grid>
        </Section>
      )}

      {step === "play_call" && halfCourtType && (
        <Section label={`Which ${halfCourtType}`} accent>
          <PlayCallPicker
            plays={playsForCategory(halfCourtType)}
            onPick={(id) => { setPlayCallId(id); setStep("flags"); }}
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
          <Section label={`${possessionType.toUpperCase()} play`} accent>
            <PlayCallPicker
              plays={playsForCategory(possessionType)}
              onPick={(id) => setPlayCallId(id)}
              adding={addingPlayFor === possessionType}
              onStartAdd={() => setAddingPlayFor(possessionType)}
              newName={newPlayName}
              onNewName={setNewPlayName}
              onSaveNew={() => addPlayCall(possessionType)}
            />
          </Section>
          <Section label="Result" accent>
            <Grid cols={2}>
              <Btn onClick={() => { setOobResult("score"); setStep("shot_type"); }}>Score</Btn>
              <Btn onClick={() => { setOobResult("flowed_half_court"); setStep("flags"); }}>Flowed to half-court</Btn>
            </Grid>
          </Section>
        </>
      )}

      {step === "flags" && (
        <>
          <Grid cols={2}>
            <Btn active={paintTouch === "single"} onClick={() => setPaintTouch(paintTouch === "single" ? null : "single")}>
              Paint touch
            </Btn>
            <Btn active={paintTouch === "both"} onClick={() => setPaintTouch(paintTouch === "both" ? null : "both")}>
              Both sides
            </Btn>
          </Grid>
          <Btn onClick={() => setOrebCount((c) => c + 1)} style={{ marginTop: 8, width: "100%" }}>
            OREB {orebCount ? `(${orebCount})` : ""}
          </Btn>
          <Grid cols={4} style={{ marginTop: 10 }}>
            <Btn onClick={() => { setPendingShot({ shotType: 2, made: true }); setStep("shot_quality"); }}>Make 2</Btn>
            <Btn onClick={() => { setPendingShot({ shotType: 2, made: false }); setStep("shot_quality"); }}>Miss 2</Btn>
            <Btn onClick={() => { setPendingShot({ shotType: 3, made: true }); setStep("shot_quality"); }}>Make 3</Btn>
            <Btn onClick={() => { setPendingShot({ shotType: 3, made: false }); setStep("shot_quality"); }}>Miss 3</Btn>
            <Btn onClick={() => setStep("turnover_type")}>Turnover</Btn>
            <Btn onClick={() => setStep("ft_points")}>FT trip</Btn>
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
            <Btn onClick={() => { setPendingShot({ shotType: 2, made: true }); setStep("shot_quality"); }}>2 pointer</Btn>
            <Btn onClick={() => { setPendingShot({ shotType: 3, made: true }); setStep("shot_quality"); }}>3 pointer</Btn>
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
              <Btn key={n} onClick={() => commit("ft_trip", { points: n })}>{n}</Btn>
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
  onPick,
  adding,
  onStartAdd,
  newName,
  onNewName,
  onSaveNew,
}: {
  plays: PlayCall[];
  onPick: (id: string) => void;
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
