// src/components/game-stats/PossessionEditor.tsx
// Film-review tool: the only way to correct a game's tracked possessions,
// and only reachable once a game is finished (tracking is locked at that
// point -- see GameStatsHub's "Reopen for tracking" if that happened too
// early).
//
// Shows every possession for this game merged from TWO sources: whatever
// made it to Supabase, plus anything still stuck in this device's local
// offline queue for this game (which the report/normal queries never see,
// since they only read from Supabase). A queued copy always wins over a
// synced copy with the same id, since the queued one is the newer,
// not-yet-confirmed edit. A small red ⚠ marks anything still queued, with
// the real sync error underneath if it's actually failed rather than just
// pending.
//
// Saving an edit doesn't distinguish between "this was already synced" and
// "this was stuck in the queue" -- every save goes through queuePossession,
// which writes it locally first (instant, offline-safe) and then attempts
// to sync it immediately. Since possessions are upserted by id, that sync
// attempt naturally updates the existing Supabase row if there is one, or
// inserts a fresh one if there isn't. If the attempt fails, the corrected
// version just stays queued (replacing whatever was queued before) and
// tries again on the next sync trigger -- so editing a broken record is
// also how you retry it, with the fix already baked in.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  queuePossession,
  getQueuedPossessions,
  removeFromQueue,
  getLastSyncErrors,
  syncQueue,
  type Possession,
  type PlayCall,
  type Team,
  type PossessionType,
  type HalfCourtType,
  type OobResult,
  type Outcome,
  type ShotQuality,
  type TurnoverType,
} from "../../lib/gameStats";

interface Props {
  gameId: string;
  opponent: string;
}

const TEAMS: Team[] = ["us", "opponent"];
const POSSESSION_TYPES: PossessionType[] = ["transition", "half_court", "blob", "slob"];
const HALF_COURT_TYPES: HalfCourtType[] = ["set", "motion"];
const OOB_RESULTS: OobResult[] = ["direct_shot", "flowed_half_court", "turnover"];
const OUTCOMES: Outcome[] = ["fg_made", "fg_missed", "turnover", "ft_trip"];
const QUALITIES: ShotQuality[] = ["great", "good", "live", "tough"];
const TURNOVER_TYPES: TurnoverType[] = ["live", "dead"];

export default function PossessionEditor({ gameId, opponent }: Props) {
  const [possessions, setPossessions] = useState<Possession[]>([]);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [syncErrors, setSyncErrors] = useState<{ id: string; message: string }[]>([]);
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [quarterFilter, setQuarterFilter] = useState<number | "all">("all");
  const [teamFilter, setTeamFilter] = useState<Team | "all">("all");

  useEffect(() => { load(); }, [gameId]);

  async function load() {
    setLoading(true);
    const [{ data: syncedData }, { data: playRows }, queued] = await Promise.all([
      supabase.from("possessions").select("*").eq("game_id", gameId),
      supabase.from("play_calls").select("*").eq("status", "active"),
      getQueuedPossessions(),
    ]);
    const synced = (syncedData as Possession[]) ?? [];
    const queuedForGame = queued.filter((p) => p.game_id === gameId);

    // Merge -- a queued copy (newer, not-yet-confirmed) wins over a synced
    // copy with the same id.
    const byId = new Map(synced.map((p) => [p.id, p]));
    queuedForGame.forEach((p) => byId.set(p.id, p));
    const merged = Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);

    setPossessions(merged);
    setQueuedIds(new Set(queuedForGame.map((p) => p.id)));
    setSyncErrors(getLastSyncErrors());
    setPlayCalls((playRows as PlayCall[]) ?? []);
    setLoading(false);
  }

  async function save(p: Possession, patch: Partial<Possession>) {
    setSavingId(p.id);
    const updated = { ...p, ...patch };
    setPossessions((list) => list.map((x) => (x.id === p.id ? updated : x)));
    await queuePossession(updated); // writes locally, then attempts to sync immediately (upsert by id)
    await load(); // refreshes queued/error state to reflect whether that attempt actually landed
    setSavingId(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this possession? This can't be undone.")) return;
    await supabase.from("possessions").delete().eq("id", id); // harmless no-op if it was never actually synced
    await removeFromQueue(id);
    setPossessions((list) => list.filter((x) => x.id !== id));
  }

  async function retrySync() {
    await syncQueue();
    await load();
  }

  const quartersPresent = useMemo(() => Array.from(new Set(possessions.map((p) => p.quarter))).sort((a, b) => a - b), [possessions]);

  const filtered = possessions.filter((p) => {
    if (quarterFilter !== "all" && p.quarter !== quarterFilter) return false;
    if (teamFilter !== "all" && p.team !== teamFilter) return false;
    return true;
  });

  if (loading) return <div className="card">Loading possessions…</div>;

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Editing possessions · vs {opponent}
          {queuedIds.size > 0 && <span style={{ color: "#c2402f" }}> · {queuedIds.size} unsynced</span>}
        </div>
        {queuedIds.size > 0 && (
          <button style={actionBtn} onClick={retrySync}>Retry sync</button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setQuarterFilter("all")} style={pillStyle(quarterFilter === "all")}>All quarters</button>
        {quartersPresent.map((q) => (
          <button key={q} onClick={() => setQuarterFilter(q)} style={pillStyle(quarterFilter === q)}>Q{q}</button>
        ))}
        <span style={{ width: 12 }} />
        <button onClick={() => setTeamFilter("all")} style={pillStyle(teamFilter === "all")}>Both teams</button>
        <button onClick={() => setTeamFilter("us")} style={pillStyle(teamFilter === "us")}>Us</button>
        <button onClick={() => setTeamFilter("opponent")} style={pillStyle(teamFilter === "opponent")}>Opponent</button>
      </div>

      {filtered.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No possessions in this filter.</div>}

      {filtered.map((p) => {
        const isQueued = queuedIds.has(p.id);
        const err = syncErrors.find((e) => e.id === p.id)?.message;
        const relevantPlayCalls = playCalls.filter((pc) =>
          p.possession_type === "blob" || p.possession_type === "slob"
            ? pc.category === p.possession_type
            : p.half_court_type
            ? pc.category === p.half_court_type
            : false
        );

        return (
          <div key={p.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Q{p.quarter} · #{p.sequence}</span>
                {isQueued && (
                  <span style={{ fontSize: 12, color: "#c2402f" }} title={err ?? "Not yet synced"}>
                    ⚠ {err ? "sync failed" : "unsynced"}
                  </span>
                )}
                {savingId === p.id && <span style={{ fontSize: 11, color: "var(--muted)" }}>saving…</span>}
              </div>
              <button style={{ ...actionBtn, background: "transparent", color: "#8a2f2f" }} onClick={() => remove(p.id)}>Delete</button>
            </div>
            {err && isQueued && <div style={{ fontSize: 11, color: "#c2402f", marginBottom: 8 }}>{err}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
              <Field label="Team">
                <select value={p.team} onChange={(e) => save(p, { team: e.target.value as Team })} style={selectStyle}>
                  {TEAMS.map((t) => <option key={t} value={t}>{t === "us" ? "Us" : "Opponent"}</option>)}
                </select>
              </Field>

              <Field label="Quarter">
                <input type="number" min={1} max={8} value={p.quarter} onChange={(e) => save(p, { quarter: Number(e.target.value) })} style={selectStyle} />
              </Field>

              <Field label="Possession type">
                <select value={p.possession_type} onChange={(e) => save(p, { possession_type: e.target.value as PossessionType })} style={selectStyle}>
                  {POSSESSION_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </select>
              </Field>

              {p.possession_type === "half_court" && (
                <Field label="Set/Motion">
                  <select value={p.half_court_type ?? ""} onChange={(e) => save(p, { half_court_type: (e.target.value || null) as HalfCourtType | null })} style={selectStyle}>
                    <option value="">—</option>
                    {HALF_COURT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              )}

              {(p.possession_type === "blob" || p.possession_type === "slob" || p.half_court_type) && (
                <Field label="Play call">
                  <select value={p.play_call_id ?? ""} onChange={(e) => save(p, { play_call_id: e.target.value || null })} style={selectStyle}>
                    <option value="">—</option>
                    {relevantPlayCalls.map((pc) => <option key={pc.id} value={pc.id}>{pc.name}</option>)}
                  </select>
                </Field>
              )}

              {(p.possession_type === "blob" || p.possession_type === "slob") && (
                <Field label="OOB result">
                  <select value={p.oob_result ?? ""} onChange={(e) => save(p, { oob_result: (e.target.value || null) as OobResult | null })} style={selectStyle}>
                    <option value="">—</option>
                    {OOB_RESULTS.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                  </select>
                </Field>
              )}

              <Field label="Paint touch">
                <label style={checkboxLabelStyle}>
                  <input type="checkbox" checked={p.paint_touch} onChange={(e) => save(p, { paint_touch: e.target.checked })} /> touched
                </label>
              </Field>

              <Field label="Both sides">
                <label style={checkboxLabelStyle}>
                  <input type="checkbox" checked={p.paint_touch_both_sides} onChange={(e) => save(p, { paint_touch_both_sides: e.target.checked })} /> both sides
                </label>
              </Field>

              <Field label="OREB count">
                <input type="number" min={0} value={p.oreb_count} onChange={(e) => save(p, { oreb_count: Number(e.target.value) })} style={selectStyle} />
              </Field>

              <Field label="Missed FG count">
                <input type="number" min={0} value={p.missed_fg_count} onChange={(e) => save(p, { missed_fg_count: Number(e.target.value) })} style={selectStyle} />
              </Field>

              <Field label="Outcome">
                <select value={p.outcome} onChange={(e) => save(p, { outcome: e.target.value as Outcome })} style={selectStyle}>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                </select>
              </Field>

              {(p.outcome === "fg_made" || p.outcome === "fg_missed") && (
                <>
                  <Field label="Shot type">
                    <select value={p.shot_type ?? ""} onChange={(e) => save(p, { shot_type: e.target.value ? (Number(e.target.value) as 2 | 3) : null })} style={selectStyle}>
                      <option value="">—</option>
                      <option value="2">2pt</option>
                      <option value="3">3pt</option>
                    </select>
                  </Field>
                  <Field label="Shot quality">
                    <select value={p.shot_quality ?? ""} onChange={(e) => save(p, { shot_quality: (e.target.value || null) as ShotQuality | null })} style={selectStyle}>
                      <option value="">—</option>
                      {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
                    </select>
                  </Field>
                </>
              )}

              {p.outcome === "turnover" && (
                <Field label="Turnover type">
                  <select value={p.turnover_type ?? ""} onChange={(e) => save(p, { turnover_type: (e.target.value || null) as TurnoverType | null })} style={selectStyle}>
                    <option value="">—</option>
                    {TURNOVER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              )}

              {p.outcome === "ft_trip" && (
                <Field label="FT attempts">
                  <select value={p.ft_attempts ?? ""} onChange={(e) => save(p, { ft_attempts: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : null })} style={selectStyle}>
                    <option value="">—</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </Field>
              )}

              <Field label="Points">
                <input type="number" min={0} max={3} value={p.points} onChange={(e) => save(p, { points: Number(e.target.value) })} style={selectStyle} />
              </Field>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 13,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  padding: "5px 0",
  color: "var(--text)",
};

const actionBtn: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    fontSize: 13,
    borderRadius: 20,
    border: `1px solid ${active ? "var(--royal-light)" : "var(--border)"}`,
    background: active ? "var(--royal)" : "var(--surface2)",
    color: active ? "#fff" : "var(--text)",
    cursor: "pointer",
  };
}
