// src/components/DurationInput.tsx
// Minutes : Seconds . Hundredths entry — three separate digit fields
// that auto-advance as you type, and let you backspace back into the
// previous field to fix a typo. Reports total seconds as a string
// (so the rest of the scoring pipeline needs no changes) — this only
// changes how the value is entered.

import { useState, useEffect, useRef } from "react";

interface Props {
  valueSeconds: string; // total seconds as a string, e.g. "250.16" or ""
  onChange: (totalSecondsStr: string) => void;
}

function splitTotal(total: number) {
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  const hundredths = Math.round((total - Math.floor(total)) * 100);
  return { mins, secs, hundredths };
}

export default function DurationInput({ valueSeconds, onChange }: Props) {
  const [mins, setMins] = useState("");
  const [secs, setSecs] = useState("");
  const [hun, setHun]   = useState("");

  const minRef = useRef<HTMLInputElement>(null);
  const secRef = useRef<HTMLInputElement>(null);
  const hunRef = useRef<HTMLInputElement>(null);

  // Sync from outside (e.g. the Stopwatch button auto-filling a time) —
  // but skip if it already matches what these fields represent, so we
  // never disrupt someone mid-typing.
  useEffect(() => {
    const total = parseFloat(valueSeconds) || 0;
    const currentTotal = (parseInt(mins || "0") * 60) + (parseInt(secs || "0")) + (parseInt(hun || "0") / 100);
    if (Math.abs(total - currentTotal) < 0.005) return;
    if (total <= 0) { setMins(""); setSecs(""); setHun(""); return; }
    const split = splitTotal(total);
    setMins(String(split.mins));
    setSecs(String(split.secs).padStart(2, "0"));
    setHun(String(split.hundredths).padStart(2, "0"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueSeconds]);

  function emit(m: string, s: string, h: string) {
    const total = (parseInt(m || "0") * 60) + (parseInt(s || "0")) + (parseInt(h || "0") / 100);
    onChange(total > 0 ? total.toString() : "");
  }

  function handleMins(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 2);
    setMins(digits);
    emit(digits, secs, hun);
    if (digits.length === 2) secRef.current?.focus();
  }
  function handleSecs(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 2);
    setSecs(digits);
    emit(mins, digits, hun);
    if (digits.length === 2) hunRef.current?.focus();
  }
  function handleHun(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 2);
    setHun(digits);
    emit(mins, secs, digits);
  }

  const boxStyle: React.CSSProperties = {
    textAlign: "center", fontSize: 18, fontWeight: 600, background: "var(--surface2)",
    border: "1px solid var(--border)", borderRadius: 8, padding: "10px 4px",
    color: "var(--text)", fontFamily: "inherit", outline: "none", width: 42,
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input ref={minRef} type="text" inputMode="numeric" pattern="[0-9]*" value={mins} placeholder="0"
        onChange={e => handleMins(e.target.value)}
        onFocus={e => e.target.select()}
        style={boxStyle} />
      <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 16 }}>:</span>
      <input ref={secRef} type="text" inputMode="numeric" pattern="[0-9]*" value={secs} placeholder="00"
        onChange={e => handleSecs(e.target.value)}
        onFocus={e => e.target.select()}
        onKeyDown={e => { if (e.key === "Backspace" && secs === "") minRef.current?.focus(); }}
        style={boxStyle} />
      <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 16 }}>.</span>
      <input ref={hunRef} type="text" inputMode="numeric" pattern="[0-9]*" value={hun} placeholder="00"
        onChange={e => handleHun(e.target.value)}
        onFocus={e => e.target.select()}
        onKeyDown={e => { if (e.key === "Backspace" && hun === "") secRef.current?.focus(); }}
        style={boxStyle} />
      <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>min:sec.hh</span>
    </div>
  );
}
