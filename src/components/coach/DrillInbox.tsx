// src/components/coach/DrillInbox.tsx
// Top of the Drill Library: drills other teams at your school sent
// ("New from Boys Basketball") with Add to library / No thanks, and
// "Add from a code" for a drill a coach at another school shared.
// A share link (…?drillcode=DRL-7K4Q) opens here with the code filled in.

import { useEffect, useState } from "react";
import { addDrillFromCode, getDrillInbox, lookupDrillCode, pickSentDrill, tidyCode, type CodeLookup, type InboxDrill } from "../../lib/drillSharing";

function codeFromUrl(): string {
  try { return tidyCode(new URLSearchParams(window.location.search).get("drillcode") ?? ""); }
  catch { return ""; }
}

export default function DrillInbox({ onAdded }: { onAdded: () => void }) {
  const [items, setItems] = useState<InboxDrill[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const linked = codeFromUrl();
  const [codeOpen, setCodeOpen] = useState(!!linked);
  const [code, setCode] = useState(linked);
  const [found, setFound] = useState<CodeLookup | null>(null);

  useEffect(() => { getDrillInbox().then(setItems); }, []);
  // A share link: look the code up straight away.
  useEffect(() => { if (linked) check(linked); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function pick(it: InboxDrill, add: boolean) {
    setBusy(it.id); setErr(null); setNote(null);
    try {
      await pickSentDrill(it.id, add);
      setItems(list => list.filter(x => x.id !== it.id));
      if (add) { setNote(`Added "${it.title}" from ${it.from}. It's your team's copy now; change it any way you like.`); onAdded(); }
    } catch (e: any) { setErr(e?.message ?? "Couldn't do that."); }
    finally { setBusy(null); }
  }

  async function check(raw: string) {
    const c = tidyCode(raw);
    setFound(null); setErr(null); setNote(null);
    if (!c) return;
    setBusy("code");
    setFound(await lookupDrillCode(c));
    setBusy(null);
  }

  async function addCode() {
    setBusy("code"); setErr(null);
    try {
      const title = await addDrillFromCode(tidyCode(code));
      setNote(`Added "${title}". It's your team's copy now; change it any way you like.`);
      setFound(null); setCode(""); setCodeOpen(false); onAdded();
      // Don't offer the same link's code again on refresh.
      try { const u = new URL(window.location.href); u.searchParams.delete("drillcode"); window.history.replaceState(null, "", u.toString()); } catch { /* fine */ }
    } catch (e: any) { setErr(e?.message ?? "Couldn't add it."); }
    finally { setBusy(null); }
  }

  const btn = { height: 34, padding: "0 12px", borderRadius: 8, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" } as const;
  const primary = { ...btn, border: 0, background: "var(--royal)", color: "#fff" };
  const quiet = { ...btn, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" };

  return (
    <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {items.length > 0 && (
        <div style={{ background: "rgba(26,63,168,0.10)", border: "1px solid rgba(147,180,255,0.30)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>📨 Sent to your team</div>
          {items.map(it => (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--surface2)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>New from {it.from}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{it.title}</div>
                {it.category && <div style={{ fontSize: 11, color: "var(--muted)" }}>{it.category}</div>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => pick(it, true)} disabled={busy === it.id} style={primary}>{busy === it.id ? "…" : "Add to library"}</button>
                <button onClick={() => pick(it, false)} disabled={busy === it.id} style={quiet}>No thanks</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {codeOpen ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Add a drill from a code</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>A coach at another school can share a drill with a code like DRL-7K4Q.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input value={code} onChange={e => { setCode(e.target.value); setFound(null); }} onKeyDown={e => { if (e.key === "Enter") check(code); }}
              placeholder="DRL-7K4Q" autoCapitalize="characters"
              style={{ flex: "1 1 140px", height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", padding: "0 10px", fontFamily: "inherit", fontSize: 14, letterSpacing: 1 }} />
            <button onClick={() => check(code)} disabled={busy === "code" || !tidyCode(code)} style={quiet}>Look it up</button>
            <button onClick={() => { setCodeOpen(false); setFound(null); setCode(""); }} style={quiet}>Cancel</button>
          </div>
          {found && !found.ok && <div style={{ fontSize: 12, color: "var(--danger-text, #f08)" }}>{found.why}</div>}
          {found && found.ok && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--surface2)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>From {found.from}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{found.title}</div>
              </div>
              <button onClick={addCode} disabled={busy === "code"} style={primary}>{busy === "code" ? "…" : "Add to library"}</button>
            </div>
          )}
        </div>
      ) : (
        <button onClick={() => setCodeOpen(true)} style={{ ...quiet, alignSelf: "flex-start" }}>🔑 Add from a code</button>
      )}

      {note && <div style={{ fontSize: 12, color: "var(--success-text)" }}>{note}</div>}
      {err && <div style={{ fontSize: 12, color: "var(--danger-text, #f08)" }}>{err}</div>}
    </div>
  );
}
