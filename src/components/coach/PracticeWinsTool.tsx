// src/components/coach/PracticeWinsTool.tsx
import { useState, useEffect, useCallback } from "react";
import { formatDateOnly } from "../../lib/schedule";
import { supabase } from "../../lib/supabase";
import { getPractice, getRosters, getWinnableDrills, WinnableDrill, Practice, Roster } from "../../lib/practicePlanner";
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
  // Drill first, then who won. Typing a name between blocks is the worst
  // possible input, and it's what makes "Shell Drill" and "shell drill"
  // two rows in the history.
  const [winnable, setWinnable] = useState<WinnableDrill[]>([]);
  const [pickedDrill, setPickedDrill] = useState<WinnableDrill | null>(null);
  const [freeText, setFreeText] = useState(false);
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
    setWinnable(await getWinnableDrills(practiceId));
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
      const name = pickedDrill ? (pickedDrill.label?.trim() || pickedDrill.title) : drillName;
      await logPracticeWin(practiceId, Array.from(selected), name);
      // Clear the names but keep the drill — three rounds at one station
      // shouldn't mean re-picking it three times.
      setSelected(new Set());
      if (!pickedDrill) setDrillName("");
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
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Practice Wins — {formatDateOnly(practice.practice_date)}</div>

      {/* 1 — which drill. Tapping one keeps it selected after you log, so
          three rounds at a station is three taps rather than three
          re-picks. The count is what "it disappears once logged" was
          reaching for, without blocking a second win on the same drill. */}
      {winnable.length > 0 && !freeText && (
        <>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Which drill</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
            {winnable.map(d => {
              const on = pickedDrill?.drillId === d.drillId;
              const logged = wins.filter(w => w.drill_name === (d.label?.trim() || d.title)).length;
              return (
                <button key={d.drillId}
                  onClick={() => { setPickedDrill(on ? null : d); setSelected(new Set()); }}
                  style={{
                    textAlign: "left", fontSize: 13, padding: "9px 11px", borderRadius: 8, cursor: "pointer",
                    fontFamily: "inherit", fontWeight: 600,
                    border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`,
                    background: on ? "rgba(240,192,64,0.12)" : "var(--surface2)",
                    color: on ? "var(--gold)" : "var(--text)",
                  }}>
                  {d.title}{d.label ? ` · ${d.label}` : ""}
                  {logged > 0 && <span style={{ float: "right", fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>{logged} logged</span>}
                </button>
              );
            })}
          </div>
          <button onClick={() => { setFreeText(true); setPickedDrill(null); }}
            style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 11.5, cursor: "pointer", padding: 0, marginBottom: 12 }}>
            Something else…
          </button>
        </>
      )}

      {(freeText || winnable.length === 0) && (
        <>
          <input value={drillName} onChange={e => setDrillName(e.target.value)} placeholder="Drill (optional)" style={{ ...inputStyle, width: "100%", marginBottom: 6 }} />
          {winnable.length > 0 && (
            <button onClick={() => { setFreeText(false); setDrillName(""); }}
              style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 11.5, cursor: "pointer", padding: 0, marginBottom: 10 }}>
              ← Back to the practice&rsquo;s drills
            </button>
          )}
          {winnable.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
              No drills in this practice are marked as ones somebody wins. Tick &ldquo;Somebody wins this drill&rdquo; in the drill library to have them offered here.
            </div>
          )}
        </>
      )}

      {/* 2 — who won. A drill's groups are one tap each; names are still
          underneath for a single winner or an adjustment. */}
      {pickedDrill && pickedDrill.groups.length > 0 && (
        <>
          {/* On a rotating block these are the block's rotation groups, so
              they're the same at every station — the label says which kind
              you're looking at rather than leaving it ambiguous. */}
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
            {pickedDrill.groups[0]?.label.startsWith("Group ") && pickedDrill.groups.length > 1
              ? "Rotation groups" : "Groups at this drill"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {pickedDrill.groups.map((g, gi) => {
              const all = g.memberIds.length > 0 && g.memberIds.every(id => selected.has(id));
              return (
                <button key={gi}
                  onClick={() => setSelected(prev => {
                    const next = new Set(prev);
                    all ? g.memberIds.forEach(id => next.delete(id)) : g.memberIds.forEach(id => next.add(id));
                    return next;
                  })}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                    border: `1px solid ${all ? "var(--royal)" : "var(--border)"}`,
                    background: all ? "var(--royal)" : "transparent",
                    color: all ? "#fff" : "var(--text)",
                  }}>
                  {g.label} ({g.memberIds.length})
                </button>
              );
            })}
          </div>
        </>
      )}

      {rosters.map(r => {
        const pool = pickedDrill?.poolIds;
        const rosterPlayers = players
          .filter(p => p.home_roster_id === r.id)
          .filter(p => !pool || pool.includes(p.id));
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
