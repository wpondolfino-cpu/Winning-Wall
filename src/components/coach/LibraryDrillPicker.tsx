// src/components/coach/LibraryDrillPicker.tsx
// Search-and-select picker for attaching an existing Drill Library entry
// to the group currently being built, instead of creating a duplicate
// drill from scratch. Mirrors the lifting module's ExercisePicker pattern.

import { useState, useEffect } from "react";
import { Workout, getWorkouts } from "../../lib/supabase";
import { getCategories } from "../../lib/categories";

interface Props {
  onSelect: (drill: Workout) => void;
}

export default function LibraryDrillPicker({ onSelect }: Props) {
  const [drills, setDrills] = useState<Workout[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [open, setOpen] = useState(false);

  useEffect(() => { getWorkouts().then(setDrills).catch(console.error); getCategories().then(cs => setCategories(cs.map(c => c.name))); }, []);

  const filtered = drills.filter(d => {
    const matchName = query === "" || d.title.toLowerCase().includes(query.toLowerCase());
    const matchCategory = categoryFilter === "All" || d.category === categoryFilter;
    const matchArchived = (d as any).library_archived !== true;
    return matchName && matchCategory && matchArchived;
  });

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", background: "var(--surface)", border: "1px dashed var(--border)",
          borderRadius: 8, padding: "9px 12px", color: "var(--muted)", fontSize: 12,
          fontFamily: "inherit", cursor: "pointer", textAlign: "left",
        }}
      >
        🔍 {open ? "Hide" : "Or attach an existing drill from the Library instead"}
      </button>

      {open && (
        <div style={{ marginTop: 8, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
          <input
            value={query} onChange={e => setQuery(e.target.value)} placeholder="Search drills…"
            style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
            {(["All", ...categories]).map(c => (
              <button key={c} onClick={() => setCategoryFilter(c)}
                style={{ padding: "4px 9px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, background: categoryFilter === c ? "var(--royal)" : "var(--surface)", color: categoryFilter === c ? "#fff" : "var(--muted)" }}>
                {c}
              </button>
            ))}
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>No drills match.</div>
            ) : filtered.map(d => (
              <div key={d.id} onClick={() => { onSelect(d); setOpen(false); setQuery(""); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--surface)", borderRadius: 7, cursor: "pointer", border: "1px solid var(--border)" }}>
                <span style={{ fontSize: 14 }}>{d.emoji ?? "🏀"}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1 }}>{d.title}</span>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{d.category}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
