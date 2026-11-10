// src/components/coach/TagChipPicker.tsx
// Pick a drill's tags by tapping: every tag already used in the library
// shows as a chip, chosen ones are filled in, and a box underneath adds a
// new one. Tags are what "Where the time went" counts, so a drill tagged
// three ways counts its minutes under all three.

import { useState } from "react";

interface Props {
  all: string[];                 // tags already in the library
  value: string[];               // this drill's tags
  onChange: (tags: string[]) => void;
}

export default function TagChipPicker({ all, value, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const chosen = new Set(value);
  // Everything known, plus any of this drill's own that aren't in the list yet.
  const options = Array.from(new Set([...all, ...value])).sort((a, b) => a.localeCompare(b));

  function toggle(t: string) {
    onChange(chosen.has(t) ? value.filter(x => x !== t) : [...value, t]);
  }
  function addDraft() {
    const parts = draft.split(",").map(s => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      // Reuse an existing tag if it only differs in capitals.
      const match = options.find(o => o.toLowerCase() === p.toLowerCase()) ?? p;
      if (!next.includes(match)) next.push(match);
    }
    onChange(next);
    setDraft("");
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
        Tags <span style={{ fontSize: 11 }}>— tap all that apply; each one counts in Where the time went</span>
      </div>
      {options.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {options.map(t => {
            const on = chosen.has(t);
            return (
              <button key={t} type="button" onClick={() => toggle(t)}
                style={{
                  fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
                  background: on ? "var(--royal)" : "var(--surface2)", color: on ? "#fff" : "var(--text)",
                  border: on ? "1px solid var(--royal)" : "1px solid var(--border)", fontWeight: on ? 600 : 400,
                }}>
                {on ? "✓ " : ""}{t}
              </button>
            );
          })}
        </div>
      )}
      <input value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addDraft(); } }}
        onBlur={addDraft}
        placeholder="+ New tag (type and press Enter)"
        style={{ width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit" }} />
    </div>
  );
}
