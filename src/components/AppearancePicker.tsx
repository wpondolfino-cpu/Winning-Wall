// src/components/AppearancePicker.tsx
// My Profile → Appearance: Dark / Light / Match my phone (migration 199).
// Saved on the account, so it follows the person to every device.

import { useState } from "react";
import { Appearance, saveAppearance, currentAppearance } from "../lib/theme";

const OPTIONS: { value: Appearance; label: string }[] = [
  { value: "dark", label: "🌙 Dark" },
  { value: "light", label: "☀️ Light" },
  { value: "system", label: "📱 Match my phone" },
];

export default function AppearancePicker({ initial, onSaved }: { initial?: Appearance; onSaved?: (a: Appearance) => void }) {
  const [value, setValue] = useState<Appearance>(initial ?? currentAppearance());
  const [error, setError] = useState<string | null>(null);

  async function pick(a: Appearance) {
    const before = value;
    setValue(a); setError(null);
    try { await saveAppearance(a); onSaved?.(a); }
    catch (e: any) {
      setError(/set_appearance/.test(e?.message ?? "") ? "Light mode isn't switched on yet (migration 199)." : (e?.message ?? "Couldn't save that."));
      setValue(before);
    }
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Appearance</div>
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 12px" }}>
        Saved to your account, so it follows you to every device.
      </div>
      <div role="radiogroup" aria-label="Appearance"
        style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, padding: 4, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
        {OPTIONS.map(o => {
          const on = value === o.value;
          return (
            <button key={o.value} role="radio" aria-checked={on} onClick={() => pick(o.value)}
              style={{
                height: 38, padding: "0 14px", borderRadius: 9, border: 0, cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                background: on ? "var(--royal)" : "transparent", color: on ? "#fff" : "var(--muted)",
              }}>
              {o.label}
            </button>
          );
        })}
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--danger-text)", marginTop: 8 }}>{error}</div>}
    </div>
  );
}
