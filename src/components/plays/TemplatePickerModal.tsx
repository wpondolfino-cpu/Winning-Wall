// src/components/plays/TemplatePickerModal.tsx
// Opened from the "Pick a template" button. Two tabs (Offense/
// Defense), each showing a grid of snapshot cards for that side's
// templates. Click a card to apply it and close. Keeps the sidebar
// from filling up with every template's name — this is the browsing
// surface instead.

import { useState } from "react";
import { Formation } from "../../lib/plays";
import TemplatePreview from "./TemplatePreview";

interface Props {
  formations: Formation[];
  canDelete: boolean;
  onPick: (f: Formation) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function TemplatePickerModal({ formations, canDelete, onPick, onDelete, onClose }: Props) {
  const [side, setSide] = useState<"offense" | "defense">("offense");
  const filtered = formations.filter((f) => f.side === side);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, width: "min(560px, 96vw)", maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--text)", letterSpacing: 1 }}>Pick a template</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 4, background: "var(--surface2)", borderRadius: 9, padding: 4, marginBottom: 14 }}>
          <button onClick={() => setSide("offense")}
            style={{ flex: 1, padding: "8px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: side === "offense" ? "var(--royal)" : "transparent", color: side === "offense" ? "#fff" : "var(--muted)" }}>
            🟠 Offense
          </button>
          <button onClick={() => setSide("defense")}
            style={{ flex: 1, padding: "8px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: side === "defense" ? "var(--royal)" : "transparent", color: side === "defense" ? "#fff" : "var(--muted)" }}>
            🔵 Defense
          </button>
        </div>

        <div style={{ overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {filtered.map((f) => (
            <div key={f.id} style={{ position: "relative" }}>
              <button onClick={() => onPick(f)} style={{ width: "100%", padding: 0, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--surface2)", cursor: "pointer", textAlign: "left" }}>
                <TemplatePreview data={f.data} side={f.side} />
                <div style={{ padding: "6px 8px", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{f.name}</div>
              </button>
              {canDelete && (
                <button onClick={(e) => { e.stopPropagation(); onDelete(f.id); }} title="Delete template"
                  style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 6, border: "none", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 12, cursor: "pointer", lineHeight: 1 }}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p style={{ gridColumn: "1 / -1", fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>
              No {side} templates yet — save one from the current step first.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
