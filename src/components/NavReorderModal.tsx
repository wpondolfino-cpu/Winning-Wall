// src/components/NavReorderModal.tsx
// Lets a coach/admin drag their sidebar nav items into whatever order they
// like. Uses native HTML5 drag-and-drop — no extra library needed.

import { useState } from "react";
import { supabase } from "../lib/supabase";

export interface NavItemConfig {
  key: string;
  icon: string;
  label: string;
}

interface Props {
  userId: string;
  items: NavItemConfig[];   // full config lookup, in CURRENT order
  onSaved: (newOrder: string[]) => void;
  onClose: () => void;
}

export default function NavReorderModal({ userId, items, onSaved, onClose }: Props) {
  const [order, setOrder] = useState<NavItemConfig[]>(items);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  function handleDragStart(i: number) { setDragIndex(i); }

  function handleDragOver(i: number, e: React.DragEvent) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) return;
    setOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(i);
  }

  async function handleSave() {
    setSaving(true);
    const keys = order.map(o => o.key);
    try {
      await supabase.from("profiles").update({ nav_order: keys }).eq("id", userId);
      onSaved(keys);
      onClose();
    } catch (e) {
      console.error("Failed to save nav order:", e);
      alert("Couldn't save order — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 3001, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, pointerEvents: "none" }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, width: "min(400px, 94vw)", padding: "22px 20px", pointerEvents: "all" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--text)", letterSpacing: 1, marginBottom: 4 }}>🔀 Reorder Menu</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Drag items into the order you want</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {order.map((item, i) => (
              <div
                key={item.key}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(i, e)}
                onDragEnd={() => setDragIndex(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: dragIndex === i ? "var(--royal)" : "var(--surface2)",
                  border: "1px solid var(--border)", borderRadius: 10,
                  padding: "10px 12px", cursor: "grab", userSelect: "none",
                  transition: "background 0.15s",
                }}
              >
                <span style={{ color: "var(--muted)", fontSize: 16, lineHeight: 1 }}>☰</span>
                <span style={{ fontSize: 15 }}>{item.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: dragIndex === i ? "#fff" : "var(--text)" }}>{item.label}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={onClose} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 10, padding: "10px", color: "var(--muted)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, background: "var(--royal)", border: "none", borderRadius: 10, padding: "10px", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Saving…" : "Save Order"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
