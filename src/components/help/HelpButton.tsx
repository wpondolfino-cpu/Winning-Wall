// src/components/help/HelpButton.tsx
// The "?" in the app header, and the help panel it opens for the current
// page (or the screen inside it -- see useHelpTopic in lib/help).
//
// Coaches and players get their own help for the same page. Admins see
// "✎ Edit help": change the text and steps, paste links (Full guide, Quick
// sheet, Watch), or reset to the starter text. Saves show for everyone.
//
// On a laptop the panel slides in from the right; on a phone it fills the
// screen.

import { useEffect, useState } from "react";
import {
  HelpAudience, HelpEntry, getHelp, saveHelp, resetHelp, starterHelp, isValidHelpUrl, useCurrentHelpTopic,
  PLAYER_PAGES, playerKeyFor,
} from "../../lib/help";
import { useIsMobile } from "../../hooks/useIsMobile";

interface Props {
  pageKey: string;
  audience: HelpAudience;
  isAdmin: boolean;
}

const btn: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8,
  padding: "6px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "var(--gold-text)", textTransform: "uppercase", margin: "16px 0 6px" };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none",
};

export default function HelpButton({ pageKey, audience, isAdmin }: Props) {
  const topic = useCurrentHelpTopic(pageKey);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<HelpEntry | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEntry(null); setEditing(false);
    getHelp(topic, audience).then(setEntry).catch(() => {
      const s = starterHelp(topic, audience);
      setEntry({ ...s, pageKey: topic, audience, guideUrl: null, sheetUrl: null, videoUrl: null, edited: false, updatedBy: null, updatedAt: null });
    });
  }, [open, topic, audience]);

  // Esc closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const panel: React.CSSProperties = isMobile
    ? { position: "fixed", inset: 0, zIndex: 1500, background: "var(--surface)", overflowY: "auto",
        padding: "max(16px, env(safe-area-inset-top)) 18px max(24px, env(safe-area-inset-bottom))" }
    : { position: "fixed", top: 0, right: 0, bottom: 0, width: 400, zIndex: 1500, background: "var(--surface)",
        borderLeft: "1px solid var(--border)", boxShadow: "-10px 0 30px rgba(0,0,0,0.35)", overflowY: "auto", padding: "18px 20px 28px" };

  return (
    <>
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="Help for this page" title="Help for this page"
        style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--royal-light)", background: "rgba(37,80,212,0.18)",
          color: "var(--text)", fontWeight: 700, fontSize: 15, cursor: "pointer", flexShrink: 0, fontFamily: "inherit", padding: 0 }}>
        ?
      </button>
      {open && (
        <>
          {!isMobile && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1499, background: "rgba(0,0,0,0.25)" }} />}
          <div role="dialog" aria-label="Help" style={panel}>
            {!entry ? (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading help…</div>
            ) : editing ? (
              <HelpEditor entry={entry} onClose={() => setOpen(false)}
                onDone={async () => { setEditing(false); setEntry(await getHelp(topic, audience)); }} />
            ) : (
              <HelpView entry={entry} isAdmin={isAdmin} onEdit={() => setEditing(true)} onClose={() => setOpen(false)} />
            )}
          </div>
        </>
      )}
    </>
  );
}

function Header({ title, onClose, extra }: { title: string; onClose: () => void; extra?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ flex: 1, fontSize: 18, fontWeight: 700 }}>{title}</div>
      {extra}
      <button type="button" onClick={onClose} aria-label="Close help" style={{ ...btn, padding: "4px 10px" }}>✕</button>
    </div>
  );
}

function HelpView({ entry, isAdmin, onEdit, onClose }: { entry: HelpEntry; isAdmin: boolean; onEdit: () => void; onClose: () => void }) {
  const links: [string, string, string | null][] = [
    ["📘", "Full guide", entry.guideUrl],
    ["📄", "Quick sheet", entry.sheetUrl],
    ["🎬", "Watch", entry.videoUrl],
  ];
  return (
    <>
      <Header title={`${entry.title} help`} onClose={onClose}
        extra={isAdmin ? <button type="button" onClick={onEdit} style={{ ...btn, padding: "4px 10px", fontSize: 12 }}>✎ Edit help</button> : undefined} />
      {entry.intro && <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 4px" }}>{entry.intro}</p>}
      {entry.steps.length > 0 && (
        <>
          <div style={label}>{entry.audience === "coach" ? "Things you do here" : "How to"}</div>
          {entry.steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--gold)", color: "#111826", fontSize: 12, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.45 }}>{s}</span>
            </div>
          ))}
        </>
      )}
      {links.some(l => l[2]) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          {links.filter(l => l[2]).map(([icon, text, url]) => (
            <a key={text} href={url!} target="_blank" rel="noopener noreferrer"
              style={{ ...btn, textDecoration: "none", display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span aria-hidden="true">{icon}</span>{text}
            </a>
          ))}
        </div>
      )}
      {isAdmin && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 18 }}>
          {entry.edited
            ? `Edited${entry.updatedBy ? ` by ${entry.updatedBy}` : ""}${entry.updatedAt ? `, ${new Date(entry.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}.`
            : "Starter text. ✎ Edit help to change it or add links."}
          {" "}Only admins see this line and the edit button.
        </div>
      )}
    </>
  );
}

function HelpEditor({ entry, onDone, onClose }: { entry: HelpEntry; onDone: () => void; onClose: () => void }) {
  const [audience, setAudience] = useState<HelpAudience>(entry.audience);
  const [draft, setDraft] = useState<HelpEntry>(entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which page's help is being edited for each audience. Players don't have
  // every coach page (and have a few of their own), so "Players see" gets a
  // picker that starts on the matching player page, if there is one.
  const [playerKey, setPlayerKey] = useState<string | null>(
    entry.audience === "player" ? entry.pageKey : playerKeyFor(entry.pageKey)
  );
  const coachKey = entry.audience === "coach" ? entry.pageKey : null;
  const editKey = audience === "player" ? playerKey : coachKey;

  // Switching audience (or player page) loads that help.
  useEffect(() => {
    if (!editKey) return;
    if (audience === entry.audience && editKey === entry.pageKey) { setDraft(entry); return; }
    getHelp(editKey, audience).then(setDraft).catch(() => {
      // Never leave the other audience's text in the form to be saved here.
      setDraft({ ...starterHelp(editKey, audience), pageKey: editKey, audience, guideUrl: null, sheetUrl: null, videoUrl: null, edited: false, updatedBy: null, updatedAt: null });
    });
  }, [audience, editKey, entry]);

  const set = (patch: Partial<HelpEntry>) => setDraft(d => ({ ...d, ...patch }));
  const setStep = (i: number, v: string) => set({ steps: draft.steps.map((s, j) => (j === i ? v : s)) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    set({ steps });
  };

  async function save() {
    for (const u of [draft.guideUrl, draft.sheetUrl, draft.videoUrl]) {
      if (u && u.trim() && !isValidHelpUrl(u)) { setError(`"${u}" doesn't look like a web link — it should start with https://`); return; }
    }
    setBusy(true); setError(null);
    if (!editKey) return;
    try { await saveHelp(editKey, audience, draft); onDone(); }
    catch (e: any) { setError(e?.message ?? "Couldn't save."); }
    finally { setBusy(false); }
  }
  async function reset() {
    if (!editKey) return;
    if (!window.confirm("Put back the starter text for this page? Your edits and links for this audience are removed.")) return;
    setBusy(true); setError(null);
    try { await resetHelp(editKey, audience); onDone(); }
    catch (e: any) { setError(e?.message ?? "Couldn't reset."); }
    finally { setBusy(false); }
  }

  const seg = (a: HelpAudience, text: string) => (
    <button type="button" onClick={() => setAudience(a)}
      style={{ ...btn, padding: "5px 12px", fontSize: 12,
        ...(audience === a ? { background: "rgba(37,80,212,0.25)", borderColor: "var(--royal-light)" } : {}) }}>{text}</button>
  );

  return (
    <>
      <Header title={`Edit help · ${entry.title}`} onClose={onClose} />
      <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>{seg("coach", "Coaches see")}{seg("player", "Players see")}</div>
      {audience === "player" && (
        <>
          <div style={label}>Player page</div>
          <select value={playerKey ?? ""} onChange={e => setPlayerKey(e.target.value || null)} style={input}>
            {!playerKey && <option value="">Choose a page…</option>}
            {PLAYER_PAGES.map(p => <option key={p.key} value={p.key}>{p.title}</option>)}
          </select>
          {!playerKeyFor(entry.pageKey) && entry.audience === "coach" && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Players don't see this page. Pick any player page to edit its help.</div>
          )}
        </>
      )}
      {audience === "coach" && !coachKey && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Open this page as a coach to edit the coach version.</div>
      )}
      {error && <div className="error-msg">{error}</div>}
      {editKey && <>

      <div style={label}>Title</div>
      <input value={draft.title} onChange={e => set({ title: e.target.value })} style={input} />

      <div style={label}>What this page is for</div>
      <textarea value={draft.intro} onChange={e => set({ intro: e.target.value })} rows={3} style={{ ...input, resize: "vertical" }} />

      <div style={label}>Steps</div>
      {draft.steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 6 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" style={{ ...btn, padding: "0 6px", fontSize: 11 }}>▲</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === draft.steps.length - 1} aria-label="Move down" style={{ ...btn, padding: "0 6px", fontSize: 11 }}>▼</button>
          </div>
          <textarea value={s} onChange={e => setStep(i, e.target.value)} rows={2} style={{ ...input, flex: 1, resize: "vertical" }} />
          <button type="button" onClick={() => set({ steps: draft.steps.filter((_, j) => j !== i) })} aria-label="Remove step" style={{ ...btn, padding: "4px 8px" }}>✕</button>
        </div>
      ))}
      {draft.steps.length < 10 && (
        <button type="button" onClick={() => set({ steps: [...draft.steps, ""] })} style={{ ...btn, fontSize: 12 }}>+ Add step</button>
      )}

      <div style={label}>Links — hidden while blank</div>
      {([["Full guide", "guideUrl", "Link to the coach guide in Drive"], ["Quick sheet", "sheetUrl", "Link to the one-page sheet"], ["Watch", "videoUrl", "YouTube or Drive video link"]] as const).map(([name, k, ph]) => (
        <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, width: 78, flexShrink: 0 }}>{name}</span>
          <input value={draft[k] ?? ""} onChange={e => set({ [k]: e.target.value } as any)} placeholder={ph} style={input} />
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={save} disabled={busy}
          style={{ ...btn, background: "var(--royal)", borderColor: "var(--royal)", color: "#fff", fontWeight: 600 }}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} disabled={busy} style={btn}>Cancel</button>
        <span style={{ flex: 1 }} />
        {draft.edited && <button type="button" onClick={reset} disabled={busy} style={{ ...btn, fontSize: 12 }}>Reset to starter text</button>}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>Saved help shows for everyone straight away.</div>
      </>}
    </>
  );
}
