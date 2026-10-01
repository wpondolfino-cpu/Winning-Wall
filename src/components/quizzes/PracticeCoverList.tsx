// src/components/quizzes/PracticeCoverList.tsx
// The "To cover" list on a practice: re-teach items sent from a quiz's
// results. Shows nothing when the practice has none, so it never adds
// clutter to an ordinary practice.

import { useCallback, useEffect, useState } from "react";
import { CoverItem, getCoverItems, setCoverItemDone, deleteCoverItem } from "../../lib/quizzes";
import { smallBtn } from "./quizStyles";

interface Props {
  practiceId: string;
}

export default function PracticeCoverList({ practiceId }: Props) {
  const [items, setItems] = useState<CoverItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await getCoverItems(practiceId)); }
    catch (e: any) { setError(e?.message ?? "Couldn't load the to-cover list."); }
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  async function toggle(item: CoverItem) {
    setItems(list => list.map(i => (i.id === item.id ? { ...i, done: !i.done } : i)));
    try { await setCoverItemDone(item.id, !item.done); }
    catch (e: any) { setError(e?.message ?? "Couldn't save that."); load(); }
  }

  async function remove(item: CoverItem) {
    setItems(list => list.filter(i => i.id !== item.id));
    try { await deleteCoverItem(item.id); }
    catch (e: any) { setError(e?.message ?? "Couldn't remove that."); load(); }
  }

  if (!items.length && !error) return null;

  const open = items.filter(i => !i.done).length;
  return (
    <div style={{ background: "rgba(220,50,50,0.08)", border: "1px solid rgba(220,50,50,0.3)", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#ff7b7b", marginBottom: 6 }}>
        📌 To cover{open ? ` · ${open} open` : " · all done"}
      </div>
      {error && <div className="error-msg">{error}</div>}
      {items.map(i => (
        <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
          <input type="checkbox" checked={i.done} onChange={() => toggle(i)} aria-label="Covered" />
          <span style={{ flex: 1, fontSize: 13, color: i.done ? "var(--muted)" : "var(--text)", textDecoration: i.done ? "line-through" : "none" }}>
            {i.text}
          </span>
          <button type="button" onClick={() => remove(i)} style={smallBtn} aria-label="Remove">✕</button>
        </div>
      ))}
    </div>
  );
}
