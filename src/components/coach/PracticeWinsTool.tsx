// src/components/coach/PracticeWinsTool.tsx
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { getPractice, getRosters, Practice, Roster } from "../../lib/practicePlanner";
import { PracticeWin, getPracticeWins, logPracticeWin, deletePracticeWins } from "../../lib/practiceWins";
import { inputStyle } from "../../lib/inputStyle";

interface Props {
  practiceId: string;
  onClose: () => void;
}

interface PlayerLite { id: string; name: string; home_roster_id: string | null; }

// Groups flat win rows back into the tap-clusters they were logged in
// (same drill name + created within a couple seconds of each other),
// so the log reads as "who won together" rather than one row per name.
function groupWins(wins: PracticeWin[]): { key: string; drillName: string | null; ids: string[]; names: string[]; when: string }[] {
  const groups: { key: string; drillName: string | null; ids: string[]; names: string[]; when: string; t: number }[] = [];
  const sorted = [...wins].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  for (const w of sorted) {
    const t = new Date(w.created_at).getTime();
    const existing = groups.find(g => g.drillName === w.drill_name && Math.abs(g.t - t) < 3000);
    if (existing) { existing.ids.push(w.id); }
    else { groups.push({ key: w.id, drillName: w.drill_name, ids: [w.id], names: [], when: w.created_at, t }); }
  }
  return groups;
}

export default function PracticeWinsTool({ practiceId, onClose }: Props) {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [players, setPlayers] = useState<PlayerLite[]>([]);
  const [wins, setWins] = useState<PracticeWin[]>([]);
  const [drillName, setDrillName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [p, allRosters, { data: allPlayers }, w] = await Promise.all([
      getPractice(practiceId),
      getRosters(),
      supabase.from("profiles").select("id,name,home_roster_id").eq("role", "player"),
      getPracticeWins(practiceId),
    ]);
    setPractice(p);
    setRosters(allRosters.filter(r => (p?.roster_ids ?? []).includes(r.id)));
    setPlayers((allPlayers ?? []).filter(pl => (p?.roster_ids ?? []).includes(pl.home_roster_id ?? "")));
    setWins(w);
  }, [practiceId]);

  useEffect(() => { load().catch(console.error); }, [load]);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submitLog() {
    if (!selected.size) return;
    setSaving(true);
    try {
      await logPracticeWin(practiceId, Array.from(selected), drillName);
      setSelected(new Set());
      setDrillName("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function undoGroup(ids: string[]) {
    await deletePracticeWins(ids);
    load();
  }

  const nameFor = (id: string) => players.find(p => p.id === id)?.name ?? "Unknown";
  const groups = groupWins(wins).map(g => ({ ...g, names: g.ids.map(nameFor) }));

  if (!practice) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>← Close</button>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Practice Wins — {new Date(practice.practice_date).toLocaleDateString()}</div>

      <input value={drillName} onChange={e => setDrillName(e.target.value)} placeholder="Drill (optional)" style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />

      {rosters.map(r => {
        const rosterPlayers = players.filter(p => p.home_roster_id === r.id);
        if (!rosterPlayers.length) return null;
        return (
          <div key={r.id} style={{ marginBottom: 14 }}>
            {rosters.length > 1 && <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{r.name}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {rosterPlayers.map(p => {
                const on = selected.has(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => toggleSelect(p.id)}
                    style={{ padding: "10px 8px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                      background: on ? "var(--royal)" : "var(--surface2)", color: on ? "#fff" : "var(--text)",
                      border: `1px solid ${on ? "var(--royal-light)" : "var(--border)"}` }}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <button type="button" onClick={submitLog} disabled={!selected.size || saving}
        style={{ width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontWeight: 700, fontSize: 14, cursor: selected.size ? "pointer" : "default", opacity: selected.size ? 1 : 0.5, marginBottom: 20 }}>
        {saving ? "Logging…" : `Log win${selected.size > 1 ? "s" : ""}`}
      </button>

      {groups.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Logged this practice</div>
          {groups.map(g => (
            <div key={g.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
              <span>{g.names.join(", ")}{g.drillName ? ` — ${g.drillName}` : ""}</span>
              <button type="button" onClick={() => undoGroup(g.ids)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>Undo</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
