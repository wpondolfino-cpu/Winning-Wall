// src/components/coach/SaveTemplateModal.tsx
//
// One dialog instead of three chained browser prompts.
//
// The first version asked for the name, then the label, then used an
// OK/Cancel confirm to choose between "the whole practice" and "timings
// only" — which is the same mistake as making Cancel mean delete: two
// content choices sharing a button pair that means yes and no.
//
// Here the choice is two cards you pick between, and everything is
// visible at once, so you can see what you're about to save before you
// commit to it.

import { useState } from "react";
import { inputStyle } from "../../lib/inputStyle";

export default function SaveTemplateModal({ onSave, onClose, busy }: {
  onSave: (name: string, rosterLabel: string, withDrills: boolean) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [withDrills, setWithDrills] = useState(true);

  const card = (value: boolean, title: string, body: string) => (
    <button onClick={() => setWithDrills(value)}
      style={{
        flex: 1, minWidth: 190, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        borderRadius: 9, padding: 11,
        border: `1px solid ${withDrills === value ? "var(--gold)" : "var(--border)"}`,
        background: withDrills === value ? "rgba(240,192,64,0.09)" : "transparent",
      }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 3, color: withDrills === value ? "var(--gold)" : "var(--text)" }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{body}</div>
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: 16, width: "min(520px, 96vw)", padding: 22 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>Save as template</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Groups and station assignments are left out either way — they belong to one day.
        </div>

        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Name</div>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus
          placeholder="Something you'd recognise — “Standard Tuesday”"
          style={{ ...inputStyle, width: "100%", marginBottom: 12, boxSizing: "border-box" }} />

        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
          Team label <span style={{ color: "var(--muted)" }}>— optional, and only a hint. It still works on any roster.</span>
        </div>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Varsity"
          style={{ ...inputStyle, width: "100%", marginBottom: 14, boxSizing: "border-box" }} />

        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>What to save</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {card(true, "The whole practice", "Blocks, timings and every drill — with its note, coaches and split rule.")}
          {card(false, "Timings only", "The shape of the night — empty blocks at the right lengths, drills left for you.")}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 10, padding: 10, color: "var(--muted)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={() => onSave(name, label, withDrills)} disabled={busy || !name.trim()}
            style={{ flex: 1, background: "var(--gold)", border: "none", borderRadius: 10, padding: 10, color: "#1a1a1a", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: busy || !name.trim() ? 0.5 : 1 }}>
            {busy ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </div>
  );
}
