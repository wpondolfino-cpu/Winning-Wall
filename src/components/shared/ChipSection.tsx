// src/components/shared/ChipSection.tsx
import { useState } from "react";

interface Props {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onAddCustom: (v: string) => void;
}

export default function ChipSection({ label, options, selected, onToggle, onAddCustom }: Props) {
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const all = Array.from(new Set([...options, ...selected]));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {all.map(opt => {
          const on = selected.includes(opt);
          return (
            <span key={opt} onClick={() => onToggle(opt)}
              style={{ cursor: "pointer", fontSize: 12, padding: "5px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 5,
                background: on ? "rgba(26,63,168,0.15)" : "var(--surface2)", color: on ? "var(--royal-light)" : "var(--muted)",
                border: `1px solid ${on ? "var(--royal-light)" : "var(--border)"}` }}>
              {opt}
              {on && <span onClick={(e) => { e.stopPropagation(); onToggle(opt); }} style={{ fontSize: 12, lineHeight: 1 }}>×</span>}
            </span>
          );
        })}
        {!adding ? (
          <span onClick={() => setAdding(true)}
            style={{ cursor: "pointer", fontSize: 12, padding: "5px 10px", borderRadius: 8, background: "var(--surface2)", color: "var(--muted)", border: "1px dashed var(--border)" }}>
            + Add
          </span>
        ) : (
          <span style={{ display: "flex", gap: 4 }}>
            <input autoFocus value={custom} onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && custom.trim()) { onAddCustom(custom.trim()); setCustom(""); setAdding(false); } if (e.key === "Escape") { setAdding(false); setCustom(""); } }}
              placeholder="New tag…" style={{ fontSize: 12, padding: "4px 8px", width: 100 }} />
            <button type="button" onClick={() => { if (custom.trim()) { onAddCustom(custom.trim()); setCustom(""); setAdding(false); } }}
              style={{ fontSize: 12, padding: "4px 8px" }}>Add</button>
          </span>
        )}
      </div>
    </div>
  );
}
