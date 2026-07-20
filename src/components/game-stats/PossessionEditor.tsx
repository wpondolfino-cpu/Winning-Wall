// src/components/game-stats/PossessionEditor.tsx
// Film-review tool: correcting a possession here edits the already-synced
// row directly in Supabase (this only runs after the game, online, so it
// doesn't go through the offline queue GameTracker uses live).

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Possession, Outcome, ShotQuality } from "../../lib/gameStats";

interface Props {
  gameId: string;
  opponent: string;
}

const OUTCOMES: Outcome[] = ["fg_made", "fg_missed", "turnover", "ft_trip"];
const QUALITIES: ShotQuality[] = ["great", "good", "live", "tough"];

export default function PossessionEditor({ gameId, opponent }: Props) {
  const [possessions, setPossessions] = useState<Possession[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => { load(); }, [gameId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("possessions")
      .select("*")
      .eq("game_id", gameId)
      .order("sequence", { ascending: true });
    setPossessions((data as Possession[]) ?? []);
    setLoading(false);
  }

  async function save(p: Possession, patch: Partial<Possession>) {
    setSavingId(p.id);
    const updated = { ...p, ...patch };
    const { error } = await supabase.from("possessions").update(patch).eq("id", p.id);
    if (!error) setPossessions((list) => list.map((x) => (x.id === p.id ? updated : x)));
    setSavingId(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this possession? This can't be undone.")) return;
    const { error } = await supabase.from("possessions").delete().eq("id", id);
    if (!error) setPossessions((list) => list.filter((x) => x.id !== id));
  }

  if (loading) return <div className="card">Loading possessions…</div>;

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
        Editing possessions · vs {opponent}
      </div>
      {possessions.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No possessions logged yet.</div>}
      {possessions.map((p) => (
        <div key={p.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", width: 70 }}>
            Q{p.quarter} · #{p.sequence}
          </span>
          <span style={{ fontSize: 13, width: 90, textTransform: "capitalize" }}>{p.team === "us" ? "Us" : "Opp"}</span>
          <span style={{ fontSize: 13, width: 100, textTransform: "capitalize" }}>{p.possession_type.replace("_", " ")}</span>

          <select
            value={p.outcome}
            onChange={(e) => save(p, { outcome: e.target.value as Outcome })}
            style={selectStyle}
          >
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>{o.replace("_", " ")}</option>
            ))}
          </select>

          {(p.outcome === "fg_made" || p.outcome === "fg_missed") && (
            <>
              <select
                value={p.shot_type ?? ""}
                onChange={(e) => save(p, { shot_type: e.target.value ? (Number(e.target.value) as 2 | 3) : null })}
                style={selectStyle}
              >
                <option value="">shot type</option>
                <option value="2">2pt</option>
                <option value="3">3pt</option>
              </select>
              <select
                value={p.shot_quality ?? ""}
                onChange={(e) => save(p, { shot_quality: (e.target.value || null) as ShotQuality | null })}
                style={selectStyle}
              >
                <option value="">quality</option>
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </>
          )}

          {p.outcome === "ft_trip" && (
            <>
              <select
                value={p.ft_attempts ?? ""}
                onChange={(e) => save(p, { ft_attempts: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : null })}
                style={selectStyle}
              >
                <option value="">shots</option>
                <option value="1">1 shot</option>
                <option value="2">2 shots</option>
                <option value="3">3 shots</option>
              </select>
            </>
          )}

          <input
            type="number"
            min={0}
            max={3}
            value={p.points}
            onChange={(e) => save(p, { points: Number(e.target.value) })}
            style={{ ...selectStyle, width: 56 }}
          />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>pts</span>

          {savingId === p.id && <span style={{ fontSize: 11, color: "var(--muted)" }}>saving…</span>}

          <button
            onClick={() => remove(p.id)}
            style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "#8a2f2f", cursor: "pointer" }}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 13,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};
