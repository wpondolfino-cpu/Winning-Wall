// src/components/lifting/LiftingLogModal.tsx
import { useState, useEffect, useRef } from "react";
import { DayExercise, LiftingLog, calc1RM, getBestSet, calcVolume, getYouTubeId, saveLog, updateLiftingRecord } from "./lifting";

interface Props {
  dayExercise: DayExercise & { exercise: any };
  playerId: string;
  playerName: string;
  avatarUrl?: string;
  recentLogs: LiftingLog[];
  hofEligible?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface SetEntry { reps: string; weight: string; }

export default function LiftingLogModal({ dayExercise, playerId, playerName, avatarUrl, recentLogs, hofEligible, onClose, onSaved }: Props) {
  const ex = dayExercise.exercise;
  const [sets, setSets] = useState<SetEntry[]>([{ reps: "", weight: "" }]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [restActive, setRestActive] = useState(false);
  const [restRemaining, setRestRemaining] = useState(dayExercise.rest_secs ?? 90);
  const [completedSetIdx, setCompletedSetIdx] = useState<number | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (restRef.current) clearInterval(restRef.current); }, []);

  function startRest(setIdx: number) {
    if (restRef.current) clearInterval(restRef.current);
    setCompletedSetIdx(setIdx);
    setRestRemaining(dayExercise.rest_secs ?? 90);
    setRestActive(true);
    restRef.current = setInterval(() => {
      setRestRemaining(r => {
        if (r <= 1) { clearInterval(restRef.current!); setRestActive(false); return 0; }
        return r - 1;
      });
    }, 1000);
  }

  function addSet() { setSets(prev => [...prev, { reps: "", weight: "" }]); }
  function removeSet(i: number) { setSets(prev => prev.filter((_, idx) => idx !== i)); }
  function updateSet(i: number, field: "reps" | "weight", val: string) {
    setSets(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  }

  const validSets = sets.filter(s => s.reps.trim() && s.weight.trim()).map(s => ({ reps: parseInt(s.reps), weight: parseFloat(s.weight) }));
  const best1RM = validSets.length > 0 ? validSets.reduce((max, s) => { const rm = calc1RM(s.weight, s.reps); return rm > max ? rm : max; }, 0) : 0;
  const totalVolume = calcVolume(validSets);

  async function handleSave() {
    if (validSets.length === 0) return;
    setSaving(true);
    try {
      await saveLog(playerId, ex.id, validSets, notes);
      if (hofEligible) {
        const bestSet = getBestSet(validSets);
        if (bestSet) await updateLiftingRecord(playerId, playerName, avatarUrl ?? null, ex.id, bestSet.weight, best1RM);
      }
      onSaved(); onClose();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="log-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title" style={{ marginBottom: 2 }}>{ex?.name}</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>
          {ex?.muscle_group}
          {hofEligible && <span style={{ marginLeft: 8, color: "var(--gold)" }}>🏆 HOF Eligible</span>}
        </div>

        {/* Video */}
        {ex?.video_url && (() => {
          const id = getYouTubeId(ex.video_url);
          const isShort = ex.video_url.includes("/shorts/");
          if (!id) return null;
          if (isShort) {
            return (
              <a href={ex.video_url} target="_blank" rel="noreferrer"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", background: "rgba(255,0,0,0.1)", border: "1px solid rgba(255,0,0,0.2)", borderRadius: 10, marginBottom: 14, color: "#ff7b7b", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
                📱 Watch Demo on YouTube Shorts ↗
              </a>
            );
          }
          return (
            <div style={{ borderRadius: 10, overflow: "hidden", marginBottom: 14, background: "#000", position: "relative", paddingTop: "40%" }}>
              <iframe src={`https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`} title={ex?.name} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} />
            </div>
          );
        })()}

        {/* Target */}
        {(dayExercise.target_sets || dayExercise.target_reps || dayExercise.target_weight) && (
          <div style={{ padding: "8px 12px", background: "rgba(26,63,168,0.1)", border: "1px solid rgba(26,63,168,0.25)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", marginBottom: 12, lineHeight: 1.5 }}>
            🎯 Target: <strong style={{ color: "#93b4ff" }}>
              {[dayExercise.target_sets && `${dayExercise.target_sets} sets`, dayExercise.target_reps && `${dayExercise.target_reps} reps`, dayExercise.target_weight && `${dayExercise.target_weight} lbs`].filter(Boolean).join(" × ")}
            </strong>
            {" · "}<span style={{ color: "var(--muted)" }}>{dayExercise.rest_secs ?? 90}s rest</span>
          </div>
        )}

        {/* Recent history */}
        {recentLogs.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Recent Sessions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {recentLogs.slice(0, 3).map((log, i) => {
                const best = getBestSet(log.sets_data);
                const vol = calcVolume(log.sets_data);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "var(--surface2)", borderRadius: 6, fontSize: 11 }}>
                    <span style={{ color: "var(--muted)" }}>{new Date(log.logged_at).toLocaleDateString()}</span>
                    <span style={{ color: "var(--silver-light)" }}>{log.sets_data.length} sets</span>
                    <span style={{ color: "#5de098", fontWeight: 600 }}>{best ? `${best.weight} lbs × ${best.reps}` : "—"}</span>
                    <span style={{ color: "var(--muted)" }}>{Math.round(vol).toLocaleString()} lbs vol</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Rest timer */}
        {restActive && (
          <div style={{ padding: "12px 16px", background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", textTransform: "uppercase" }}>⏱ Rest Timer</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Set {(completedSetIdx ?? 0) + 1} complete</div>
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, color: "var(--gold)", lineHeight: 1 }}>
              {Math.floor(restRemaining / 60)}:{String(restRemaining % 60).padStart(2, "0")}
            </div>
            <button onClick={() => { setRestActive(false); if (restRef.current) clearInterval(restRef.current); }}
              style={{ background: "none", border: "1px solid rgba(240,192,64,0.4)", color: "var(--gold)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              Skip
            </button>
          </div>
        )}

        {/* Sets */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Your Sets</div>
        <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 36px auto", gap: 6, marginBottom: 5, padding: "0 2px" }}>
          <div style={{ fontSize: 9, color: "var(--muted)", textAlign: "center" }}>#</div>
          <div style={{ fontSize: 9, color: "var(--muted)", textAlign: "center" }}>REPS</div>
          <div style={{ fontSize: 9, color: "var(--muted)", textAlign: "center" }}>WEIGHT (lbs)</div>
          <div style={{ fontSize: 9, color: "var(--muted)", textAlign: "center" }}>✓</div>
          <div />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {sets.map((s, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 36px auto", gap: 6, alignItems: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textAlign: "center" }}>{i + 1}</div>
              <input type="number" inputMode="numeric" value={s.reps} onChange={e => updateSet(i, "reps", e.target.value)} placeholder="0"
                style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 6px", color: "var(--text)", fontSize: 15, fontWeight: 600, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
              <input type="number" inputMode="decimal" value={s.weight} onChange={e => updateSet(i, "weight", e.target.value)} placeholder="0"
                style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 6px", color: "var(--text)", fontSize: 15, fontWeight: 600, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
              <button onClick={() => startRest(i)} title="Mark complete & start rest"
                style={{ background: s.reps && s.weight ? "rgba(40,180,80,0.2)" : "var(--surface2)", border: `1px solid ${s.reps && s.weight ? "rgba(40,180,80,0.4)" : "var(--border)"}`, color: s.reps && s.weight ? "#5de098" : "var(--muted)", borderRadius: 7, padding: "8px 4px", fontSize: 14, cursor: "pointer" }}>
                ✓
              </button>
              {sets.length > 1 && (
                <button onClick={() => removeSet(i)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 16, padding: "4px" }}>×</button>
              )}
            </div>
          ))}
        </div>
        <button onClick={addSet} style={{ width: "100%", background: "none", border: "1px dashed var(--border)", borderRadius: 8, padding: "8px", fontSize: 12, color: "var(--muted)", cursor: "pointer", fontFamily: "inherit", marginBottom: 12 }}>+ Add Set</button>

        {/* Live stats */}
        {validSets.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div style={{ padding: "8px 12px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>Est. 1RM</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: "var(--gold)", lineHeight: 1.2 }}>{best1RM} lbs</div>
            </div>
            <div style={{ padding: "8px 12px", background: "rgba(26,63,168,0.1)", border: "1px solid rgba(26,63,168,0.25)", borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>Volume</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: "#93b4ff", lineHeight: 1.2 }}>{Math.round(totalVolume).toLocaleString()} lbs</div>
            </div>
          </div>
        )}

        {/* Notes */}
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Session notes (optional) — how did it feel? Anything to remember?"
          rows={2}
          style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", resize: "none", boxSizing: "border-box", marginBottom: 12 }} />

        <button className="btn-primary" onClick={handleSave} disabled={saving || validSets.length === 0}>
          {saving ? "Saving…" : "Save Session"}
        </button>
      </div>
    </div>
  );
}
