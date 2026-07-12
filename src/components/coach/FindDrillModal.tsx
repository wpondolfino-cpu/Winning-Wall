// src/components/coach/FindDrillModal.tsx
// Standalone "attach an existing drill to a group" flow, triggered
// directly from Manage Workouts — no need to open the full workout
// builder form first, unlike the toggle embedded inside WorkoutBuilder.

import { useState, useEffect } from "react";
import { supabase, Workout, getWorkouts } from "../../lib/supabase";
import { loadGroupsForBuilder } from "./GroupManager";

interface Props {
  onClose: () => void;
  onAttached: () => void;
}

const CATEGORIES = ["Dribbling", "Finishing", "Shooting", "Competing", "Strength"] as const;

export default function FindDrillModal({ onClose, onAttached }: Props) {
  const [groups, setGroups] = useState<any[]>([]);
  const [groupId, setGroupId] = useState<string>("");
  const [drills, setDrills] = useState<Workout[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [attaching, setAttaching] = useState<string | null>(null);

  useEffect(() => {
    loadGroupsForBuilder().then((gs: any[]) => {
      setGroups(gs);
      const draft = gs.find((g: any) => g.status === "draft");
      setGroupId((draft ?? gs[0])?.id ?? "");
    });
    getWorkouts().then(setDrills).catch(console.error);
  }, []);

  const filtered = drills.filter(d => {
    const matchName = query === "" || d.title.toLowerCase().includes(query.toLowerCase());
    const matchCategory = categoryFilter === "All" || d.category === categoryFilter;
    const matchArchived = (d as any).library_archived !== true;
    return matchName && matchCategory && matchArchived;
  });

  async function attach(drill: Workout) {
    const group = groups.find(g => g.id === groupId);
    if (!group) { alert("Pick a group first."); return; }
    setAttaching(drill.id);
    try {
      const { error } = await supabase.from("workouts").update({
        group_id: group.id,
        group_name: group.name,
        is_active: group.status === "active",
      }).eq("id", drill.id);
      if (error) throw error;
      onAttached();
      onClose();
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setAttaching(null);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, width: "min(480px, 96vw)", maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 22 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--text)", letterSpacing: 1, marginBottom: 4 }}>🔍 Find Drill</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Attach an existing drill to a group — no need to rebuild it from scratch</div>

        <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4, display: "block" }}>Target Group</label>
        <select value={groupId} onChange={e => setGroupId(e.target.value)}
          style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 14 }}>
          {groups.length === 0 && <option value="">No groups yet — create one first</option>}
          {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name} {g.status === "active" ? "🌐" : g.status === "archived" ? "📦" : "📝"}</option>)}
        </select>

        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search drills…"
          style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 8 }} />

        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
          {(["All", ...CATEGORIES] as const).map(c => (
            <button key={c} onClick={() => setCategoryFilter(c)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, background: categoryFilter === c ? "var(--royal)" : "var(--surface2)", color: categoryFilter === c ? "#fff" : "var(--muted)" }}>
              {c}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
          {filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>No drills match.</div>
          ) : filtered.map(d => (
            <div key={d.id} onClick={() => !attaching && attach(d)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, cursor: attaching ? "default" : "pointer", opacity: attaching && attaching !== d.id ? 0.5 : 1 }}>
              <span style={{ fontSize: 15 }}>{d.emoji ?? "🏀"}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1 }}>{d.title}</span>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>{d.category}</span>
              {attaching === d.id && <span style={{ fontSize: 11, color: "var(--gold)" }}>Attaching…</span>}
            </div>
          ))}
        </div>

        <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "10px", color: "var(--muted)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
