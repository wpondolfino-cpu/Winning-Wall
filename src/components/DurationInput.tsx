// src/components/DurationInput.tsx
// A minutes : seconds.hundredths input. Internally still stores/reports
// total seconds as a string (so the rest of the scoring pipeline needs
// no changes) — this only changes how the value is entered.

interface Props {
  valueSeconds: string; // total seconds as a string, e.g. "250.16" or ""
  onChange: (totalSecondsStr: string) => void;
}

export default function DurationInput({ valueSeconds, onChange }: Props) {
  const total = parseFloat(valueSeconds) || 0;
  const mins = Math.floor(total / 60);
  const secs = total - mins * 60;

  function update(newMins: number, newSecs: number) {
    const t = newMins * 60 + newSecs;
    onChange(t > 0 ? t.toString() : "");
  }

  const boxStyle: React.CSSProperties = {
    textAlign: "center", fontSize: 18, fontWeight: 600, background: "var(--surface2)",
    border: "1px solid var(--border)", borderRadius: 8, padding: "10px 6px",
    color: "var(--text)", fontFamily: "inherit", outline: "none",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input type="number" inputMode="numeric" min="0" value={mins || ""} placeholder="0"
        onChange={e => update(parseInt(e.target.value) || 0, secs)}
        style={{ ...boxStyle, width: 46 }} />
      <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 16 }}>:</span>
      <input type="number" inputMode="decimal" min="0" max="59.99" step="0.01" value={secs || ""} placeholder="00.00"
        onChange={e => update(mins, parseFloat(e.target.value) || 0)}
        style={{ ...boxStyle, width: 68 }} />
      <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>min:sec</span>
    </div>
  );
}
