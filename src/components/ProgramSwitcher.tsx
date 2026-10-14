// src/components/ProgramSwitcher.tsx
// Program badge in the header. Someone in one program sees a plain label;
// someone in several (or the platform admin) gets a menu to switch.
// "View as" test accounts are added in a later step.

import { useEffect, useRef, useState } from "react";
import { loadMyPrograms, switchProgram, roleLabel, MyPrograms, ProgramInfo } from "../lib/programs";

interface Props { userId: string; }

function Badge({ p, size }: { p: ProgramInfo; size: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: size >= 36 ? 10 : 8, flexShrink: 0,
      background: p.primary, color: p.accent,
      fontFamily: "'Bebas Neue', sans-serif", fontSize: size >= 36 ? 16 : 15, letterSpacing: 0.5,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>{p.orgShort}</span>
  );
}

export default function ProgramSwitcher({ userId }: Props) {
  const [data, setData] = useState<MyPrograms | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadMyPrograms(userId).then(d => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  // Close when tapping anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  if (!data) return null;
  // Only programs this person can actually enter.
  const reachable = data.programs.filter(p => p.role !== null || data.isPlatformAdmin);
  const current = reachable.find(p => p.id === data.activeProgramId);
  if (!current) return null;

  const canSwitch = reachable.length > 1;

  if (!canSwitch) {
    return (
      <div className="program-switcher" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Badge p={current} size={28} />
        <span className="program-switcher-name" style={{ fontSize: 13, fontWeight: 600, color: "var(--silver-light)" }}>{current.name}</span>
      </div>
    );
  }

  // Group by school / organization, in the order they come back.
  const groups: { org: string; items: ProgramInfo[] }[] = [];
  for (const p of reachable) {
    const g = groups.find(x => x.org === p.orgName);
    if (g) g.items.push(p); else groups.push({ org: p.orgName, items: [p] });
  }

  async function pick(p: ProgramInfo) {
    if (p.id === current!.id) { setOpen(false); return; }
    setSwitching(p.id); setError(null);
    try { await switchProgram(p.id); }
    catch (e: any) { setSwitching(null); setError(e?.message ?? "Couldn't switch programs."); }
  }

  return (
    <div ref={wrapRef} className="program-switcher" style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu" aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 10px 0 6px",
          background: "var(--surface2)", border: `1px solid ${open ? current.primary : "var(--royal-light)"}`,
          borderRadius: 12, color: "var(--text)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>
        <Badge p={current} size={28} />
        <span className="program-switcher-name" style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.name}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b0b8c8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ transform: open ? "none" : "rotate(180deg)", transition: "transform .15s" }}><path d="M18 15l-6-6-6 6" /></svg>
      </button>

      {open && (
        <div role="menu" style={{
          position: "absolute", top: 52, right: 0, width: "min(366px, calc(100vw - 24px))", zIndex: 300,
          background: "var(--surface)", border: "1px solid rgba(176,184,200,0.22)", borderRadius: 16,
          boxShadow: "0 18px 40px rgba(0,0,0,0.55)", padding: 8, display: "flex", flexDirection: "column", gap: 2,
        }}>
          {groups.map(g => (
            <div key={g.org} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ padding: "10px 10px 6px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#8b95ae", fontWeight: 600 }}>{g.org}</div>
              {g.items.map(p => {
                const isCurrent = p.id === current.id;
                return (
                  <button key={p.id} role="menuitem" onClick={() => pick(p)} disabled={!!switching}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 10px",
                      background: isCurrent ? "var(--surface2)" : "transparent",
                      border: `1px solid ${isCurrent ? p.primary : "transparent"}`, borderRadius: 12,
                      color: "var(--text)", fontFamily: "inherit", textAlign: "left", cursor: switching ? "wait" : "pointer",
                    }}>
                    <Badge p={p} size={36} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                      <span style={{ fontSize: 12, color: "#a3adc4" }}>
                        {switching === p.id ? "Switching…" : roleLabel(p.role)}
                      </span>
                    </span>
                    {isCurrent && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={p.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Current program"><path d="M20 6L9 17l-5-5" /></svg>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {error && <div style={{ padding: "8px 10px", fontSize: 12, color: "#ff8a8a" }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
