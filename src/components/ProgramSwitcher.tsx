// src/components/ProgramSwitcher.tsx
// Program badge in the header. Someone in one program sees a plain label;
// someone in several (or the platform admin) gets a menu to switch.
// Head coaches (their Test Player) and the platform admin (every test
// account) also get a "View as" section.
//
// The platform admin can reach every program, so their menu doesn't list
// them all: their own programs, the last few they went into, a search
// once there are more than 8, the Sandbox and Shared Library, and "All
// programs" (the Schools page). Everyone else sees their programs as before.

import { useEffect, useRef, useState } from "react";
import { loadMyPrograms, switchProgram, roleLabel, recentProgramIds, MyPrograms, ProgramInfo } from "../lib/programs";
import { listTestAccounts, enterViewAs, currentViewAs, TestAccount } from "../lib/viewAs";

interface Props {
  userId: string;
  /** Platform admin only: opens the Platform pages (home, or a given page). */
  onOpenPlatform?: (page?: "schools") => void;
}

function Badge({ p, size }: { p: ProgramInfo; size: number }) {
  const [broken, setBroken] = useState(false);
  // The school's (or program's) logo when one is set; the letters otherwise,
  // and as a fallback if the image ever fails to load.
  if (p.logoUrl && !broken) {
    return (
      <img src={p.logoUrl} alt={`${p.orgName} logo`} onError={() => setBroken(true)}
        style={{ width: size, height: size, borderRadius: size >= 36 ? 10 : 8, flexShrink: 0, objectFit: "contain", display: "block" }} />
    );
  }
  return (
    <span style={{
      width: size, height: size, borderRadius: size >= 36 ? 10 : 8, flexShrink: 0,
      background: p.primary, color: p.accent,
      fontFamily: "'Bebas Neue', sans-serif", fontSize: size >= 36 ? 16 : 15, letterSpacing: 0.5,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>{p.orgShort}</span>
  );
}

export default function ProgramSwitcher({ userId, onOpenPlatform }: Props) {
  const [data, setData] = useState<MyPrograms | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tests, setTests] = useState<TestAccount[] | null>(null);
  const [testsError, setTestsError] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");

  // Who may use View as: the platform admin, or a head coach of the
  // program they're in — and never while already viewing as someone.
  const viewAsAllowed = (d: MyPrograms | null) => {
    if (!d || currentViewAs(userId)) return false;
    const cur = d.programs.find(p => p.id === d.activeProgramId);
    return !!cur && (d.isPlatformAdmin || cur.role === "head_coach");
  };

  // Test accounts are fetched (and created the first time) when the menu opens.
  useEffect(() => {
    if (!open || tests !== null || !viewAsAllowed(data)) return;
    listTestAccounts(data!.activeProgramId!)
      .then(setTests)
      .catch((e: any) => { setTests([]); setTestsError(e?.message ?? "Couldn't load test accounts."); });
  }, [open, data]);

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
  const canViewAs = viewAsAllowed(data);

  if (!canSwitch && !canViewAs && !data.isPlatformAdmin) {
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

  async function copyInvite() {
    const link = `${window.location.origin}/?join=${current!.joinCode}`;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt("Copy this invite link:", link); }
  }

  async function enter(a: TestAccount) {
    setEntering(a.user_id); setTestsError(null);
    try { await enterViewAs(a, `${current!.orgShort} ${current!.name}`); }
    catch (e: any) { setEntering(null); setTestsError(e?.message ?? "Couldn't open that account."); }
  }

  const inSandbox = current.kind === "sandbox";
  const personInitials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // Platform admin menu: a short list however many programs there are.
  const special = (p: ProgramInfo) => p.kind === "sandbox" || p.kind === "library";
  const regular = reachable.filter(p => !special(p));
  const mine = regular.filter(p => p.role !== null);
  const recent: ProgramInfo[] = [];
  for (const id of [current.id, ...recentProgramIds()]) {
    const p = regular.find(x => x.id === id);
    if (p && !mine.includes(p) && !recent.includes(p)) recent.push(p);
    if (recent.length >= 4) break;
  }
  const extras = reachable.filter(special).sort((a, b) => (a.kind === "sandbox" ? -1 : 1) - (b.kind === "sandbox" ? -1 : 1));
  const q = query.trim().toLowerCase();
  const matches = q ? regular.filter(p => `${p.name} ${p.orgName} ${p.orgShort}`.toLowerCase().includes(q)).slice(0, 10) : [];

  const sectionLabel = (text: string) => (
    <div style={{ padding: "10px 10px 6px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted-3)", fontWeight: 600 }}>{text}</div>
  );
  const programRow = (p: ProgramInfo, sub: string) => {
    const isCurrent = p.id === current.id;
    const isSandbox = p.kind === "sandbox";
    return (
      <button key={p.id} role="menuitem" onClick={() => pick(p)} disabled={!!switching}
        style={{
          display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 10px",
          background: isCurrent ? "var(--surface2)" : isSandbox ? "rgba(240,192,64,0.08)" : "transparent",
          border: `1px solid ${isCurrent ? p.primary : isSandbox ? "rgba(240,192,64,0.35)" : "transparent"}`, borderRadius: 12,
          color: "var(--text)", fontFamily: "inherit", textAlign: "left", cursor: switching ? "wait" : "pointer",
        }}>
        {isSandbox ? (
          <span style={{ width: 36, height: 36, borderRadius: 10, background: "#f0c040", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🧪</span>
        ) : <Badge p={p} size={36} />}
        <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
          <span style={{ fontSize: 12, color: "var(--muted-2)" }}>{switching === p.id ? "Switching…" : sub}</span>
        </span>
        {isCurrent && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={p.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Current program"><path d="M20 6L9 17l-5-5" /></svg>
        )}
      </button>
    );
  };
  const orgSub = (p: ProgramInfo) => [p.orgName, p.role ? roleLabel(p.role) : null].filter(Boolean).join(" · ");

  const TEST_COLORS: Record<TestAccount["role"], [string, string, string]> = {
    player:     ["#18402a", "#5de098", "TP"],
    coach:      ["#1d2a52", "#93b4ff", "TC"],
    head_coach: ["#4a3a10", "#f0c040", "TH"],
  };

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
          {data.isPlatformAdmin && onOpenPlatform && (
            <>
              <button role="menuitem" onClick={() => { setOpen(false); onOpenPlatform(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 10px",
                  background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.35)", borderRadius: 12,
                  color: "var(--text)", fontFamily: "inherit", textAlign: "left", cursor: "pointer",
                }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0a0c14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>Platform</span>
                  <span style={{ fontSize: 12, color: "var(--muted-2)" }}>Schools, programs, features, library</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3adc4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
              <div style={{ height: 1, background: "rgba(176,184,200,0.15)", margin: "6px 4px" }} />
            </>
          )}
          {data.isPlatformAdmin && (
            <>
              {regular.length > 8 && (
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="🔍 Search programs…" aria-label="Search programs"
                  style={{ height: 40, margin: "2px 4px 4px", padding: "0 12px", borderRadius: 10, border: "1px solid rgba(176,184,200,0.25)", background: "var(--surface2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14 }} />
              )}
              {q ? (
                <>
                  {sectionLabel(`${matches.length} match${matches.length === 1 ? "" : "es"}`)}
                  {matches.map(p => programRow(p, orgSub(p)))}
                </>
              ) : (
                <>
                  {mine.length > 0 && <>{sectionLabel("Your programs")}{mine.map(p => programRow(p, orgSub(p)))}</>}
                  {recent.length > 0 && <>{sectionLabel("Recent")}{recent.map(p => programRow(p, orgSub(p)))}</>}
                  {extras.length > 0 && (
                    <>
                      <div style={{ height: 1, background: "rgba(176,184,200,0.15)", margin: "6px 4px" }} />
                      {extras.map(p => programRow(p, p.kind === "sandbox" ? "Only you see this · nothing here reaches a real program" : "Library copies, edited like any program"))}
                    </>
                  )}
                  {onOpenPlatform && (
                    <button role="menuitem" onClick={() => { setOpen(false); onOpenPlatform("schools"); }}
                      style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "8px 10px", background: "transparent", border: 0, borderRadius: 12, color: "var(--info-text)", fontFamily: "inherit", fontSize: 14, fontWeight: 600, textAlign: "left", cursor: "pointer" }}>
                      <span style={{ flex: 1 }}>All programs →</span>
                      <span style={{ fontSize: 12, color: "var(--muted-3)", fontWeight: 400 }}>{regular.length}</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {!data.isPlatformAdmin && canSwitch && groups.map(g => (
            <div key={g.org} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ padding: "10px 10px 6px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted-3)", fontWeight: 600 }}>{g.org}</div>
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
                      <span style={{ fontSize: 12, color: "var(--muted-2)" }}>
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
          {error && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--danger-text-2)" }}>{error}</div>}

          {canViewAs && current.joinCode && (
            <>
              {canSwitch && <div style={{ height: 1, background: "rgba(176,184,200,0.15)", margin: "8px 4px" }} />}
              <div style={{ padding: "6px 10px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                  <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted-3)", fontWeight: 600 }}>Team code</span>
                  <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3 }}>{current.joinCode}</span>
                </span>
                <button onClick={copyInvite}
                  style={{
                    height: 40, padding: "0 12px", background: "var(--surface2)", color: "var(--text)",
                    border: "1px solid var(--royal-light)", borderRadius: 10, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>
                  {copied ? "Copied!" : "Copy invite link"}
                </button>
              </div>
            </>
          )}

          {canViewAs && (
            <>
              {(canSwitch || current.joinCode) && <div style={{ height: 1, background: "rgba(176,184,200,0.15)", margin: "8px 4px" }} />}
              <div style={{ padding: "4px 10px 6px", display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8b95ae" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted-3)", fontWeight: 600 }}>View as · {current.name}</span>
              </div>
              {tests === null && <div style={{ padding: "8px 10px", fontSize: 13, color: "var(--muted-2)" }}>{inSandbox ? "Getting the sandbox ready (the first time takes about a minute)…" : "Getting test accounts ready…"}</div>}
              {inSandbox && tests && tests.length > 0 && (
                <input value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} placeholder="Find a player…" aria-label="Find a sandbox player"
                  style={{ height: 38, margin: "2px 4px 4px", padding: "0 12px", borderRadius: 10, border: "1px solid rgba(176,184,200,0.25)", background: "var(--surface2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14 }} />
              )}
              {(tests ?? []).filter(a => !inSandbox || a.role !== "player"
                  || (peopleQuery.trim() !== "" && a.name.toLowerCase().includes(peopleQuery.trim().toLowerCase())))
                .slice(0, inSandbox ? 12 : undefined).map(a => {
                const [bg, fg, testInitials] = TEST_COLORS[a.role];
                const initials = inSandbox ? personInitials(a.name) : testInitials;
                return (
                  <button key={a.user_id} role="menuitem" onClick={() => enter(a)} disabled={!!entering}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, minHeight: 48, padding: "6px 10px",
                      background: "transparent", border: 0, borderRadius: 12, color: "var(--text)",
                      fontFamily: "inherit", fontSize: 14, textAlign: "left", cursor: entering ? "wait" : "pointer",
                    }}>
                    <span style={{ width: 30, height: 30, borderRadius: "50%", background: bg, color: fg, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials}</span>
                    <span style={{ flex: 1 }}>{entering === a.user_id ? "Opening…" : a.name}</span>
                    <span style={{ fontSize: 11, color: "var(--muted-2)", border: "1px dashed rgba(176,184,200,0.4)", borderRadius: 6, padding: "2px 6px" }}>
                      {inSandbox ? (a.role === "head_coach" ? "HEAD COACH" : a.role === "coach" ? "COACH" : "PLAYER") : "TEST"}
                    </span>
                  </button>
                );
              })}
              {testsError && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--danger-text-2)" }}>{testsError}</div>}
              <div style={{ padding: "8px 10px 6px", fontSize: 12, lineHeight: 1.45, color: "var(--muted-3)" }}>
                {inSandbox
                  ? `${(tests ?? []).filter(a => a.role === "player").length} players: type a name above, or use the Sandbox page to pick by team.`
                  : "Only test accounts are listed; real players can never be entered."}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
