// ScheduleImport — paste a table or an iCal feed, review, then import.
//
// One preview for both paths. Nothing is written until the coach presses
// Import, and every row shows what it was understood as, so a wrong guess
// is caught on screen rather than in a parent's calendar.

import { useState } from "react";
import { ImportRow, parsePastedTable, parseICal, reconcile, commitImport } from "../../lib/scheduleImport";

interface Props {
  season: string;
  seasonId: string | null;
  userId: string;
  onClose: () => void;
  onImported: () => void;
}

export default function ScheduleImport({ season, seasonId, userId, onClose, onImported }: Props) {
  const [mode, setMode] = useState<"paste" | "feed">("paste");
  const [raw, setRaw] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A season string like "2026-27" gives the starting calendar year, which
  // is what the pasted-table parser needs: those rows carry a month and day
  // but no year.
  const seasonStartYear = parseInt((season.match(/(\d{4})/) ?? ["", String(new Date().getFullYear())])[1], 10);

  async function preview() {
    setErr(null); setBusy(true);
    try {
      let parsed: ImportRow[];
      if (mode === "paste") {
        parsed = raw.trim().startsWith("BEGIN:VCALENDAR")
          ? parseICal(raw)                       // pasted feed contents still work
          : parsePastedTable(raw, seasonStartYear);
      } else {
        const res = await fetch(feedUrl);
        if (!res.ok) throw new Error(`Feed returned ${res.status}`);
        parsed = parseICal(await res.text());
      }
      if (!parsed.length) { setErr("Nothing to import — no rows found."); setRows(null); return; }
      setRows(await reconcile(parsed, season));
    } catch (e: any) {
      // A feed fetched from the browser is subject to CORS, and many
      // providers don't allow it. Saying so beats a bare network error,
      // since the fix (paste the contents instead) isn't obvious.
      setErr(mode === "feed"
        ? `Couldn't read that feed (${e.message}). Some providers block browser access — open the URL, copy the contents, and paste them here instead.`
        : e.message);
      setRows(null);
    } finally { setBusy(false); }
  }

  async function commit() {
    if (!rows) return;
    setBusy(true);
    const { created, updated } = await commitImport(rows, season, seasonId, userId);
    setBusy(false);
    onImported();
    onClose();
    window.alert(`Imported ${created} new game${created === 1 ? "" : "s"}${updated ? `, updated ${updated}` : ""}.`);
  }

  const counts = rows
    ? rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {} as Record<string, number>)
    : null;
  const willWrite = rows?.filter(r => r.status === "new" || r.status === "moved").length ?? 0;

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Import schedule</h3>
          <button onClick={onClose} style={btn}>Cancel</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button onClick={() => { setMode("paste"); setRows(null); }} style={mode === "paste" ? chipActive : btn}>Paste rows</button>
          <button onClick={() => { setMode("feed"); setRows(null); }} style={mode === "feed" ? chipActive : btn}>Calendar feed</button>
        </div>

        {mode === "paste" ? (
          <>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, lineHeight: 1.5 }}>
              Select the schedule rows on your league or school site and paste them here. Feed contents work too.
            </div>
            <textarea
              value={raw} onChange={e => setRaw(e.target.value)} rows={7}
              placeholder={"Tue Dec 15 6:30 PM\t@\tFoxborough High School\tFoxboro HS — Gym\tL"}
              style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 12, resize: "vertical" }}
            />
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, lineHeight: 1.5 }}>
              A subscribable calendar URL. Unlike a paste, a feed stays correct when a game moves — re-import any time and only the changes are applied.
            </div>
            <input value={feedUrl} onChange={e => setFeedUrl(e.target.value)} placeholder="https://…/schedule.ics" style={input} />
          </>
        )}

        <div style={{ marginTop: 10 }}>
          <button onClick={preview} disabled={busy} style={primary}>{busy ? "Reading…" : "Preview"}</button>
        </div>

        {err && <div style={{ fontSize: 12, color: "#b8342e", marginTop: 10, lineHeight: 1.5 }}>{err}</div>}

        {rows && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              Nothing is saved until you press Import.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 560 }}>
                <thead>
                  <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                    {["Date", "Time", "H/A", "Opponent", "Location", "Status"].map(h => (
                      <th key={h} style={{ padding: "6px 8px", fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={td}>{r.date ?? "—"}</td>
                      <td style={td}>{r.time ?? "—"}</td>
                      <td style={td}>{r.home_away}</td>
                      <td style={td}>{r.opponent || "—"}</td>
                      <td style={{ ...td, color: "var(--muted)" }}>{r.location ?? "—"}</td>
                      <td style={{ ...td, color: statusColor(r.status) }}>
                        {r.status}{r.note ? ` · ${r.note}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              {counts && Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ")}
              {counts?.problem ? " — problem rows are skipped, fix them at the source and re-import" : ""}
              {counts?.unchanged ? " — unchanged rows are left alone" : ""}
            </div>
            <button onClick={commit} disabled={busy || willWrite === 0} style={{ ...primary, marginTop: 10 }}>
              {willWrite === 0 ? "Nothing to import" : `Import ${willWrite} game${willWrite === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function statusColor(s: string) {
  if (s === "problem") return "#b8342e";
  if (s === "moved") return "#c48a1f";
  if (s === "unchanged") return "var(--muted)";
  return "#2f9e63";
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 };
const panel: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit" };
const td: React.CSSProperties = { padding: "6px 8px" };
const btn: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" };
const chipActive: React.CSSProperties = { ...btn, background: "var(--royal)", color: "#fff", border: "none" };
const primary: React.CSSProperties = { background: "var(--royal)", border: "none", color: "#fff", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
