// ScheduleImport — paste a schedule, review it, then import.
//
// Nothing is written until the coach presses Import, and every row shows
// what it was understood as, so a wrong guess is caught on screen rather
// than in a parent's calendar.
//
// There was a "Calendar feed" tab that took a URL. It failed on every site
// a coach round here actually uses — a browser can't read those feeds, not
// because the leagues withhold them but because they don't send the header
// that permits a web page to fetch them. Fetching from a server would fix
// that, but it would only save one copy-and-paste: the paste path already
// reconciles, so re-importing applies just the changes either way. The tab
// promised something it couldn't do, so it's gone. Pasted feed contents
// still work.

import { useState } from "react";
import { ImportRow, parsePastedTable, parseICal, reconcile, commitImport } from "../../lib/scheduleImport";

interface Props {
  season: string;
  seasonId: string | null;
  userId: string;
  rosters: { id: string; name: string }[];
  onClose: () => void;
  onImported: () => void;
}

export default function ScheduleImport({ season, seasonId, userId, rosters, onClose, onImported }: Props) {
  const [raw, setRaw] = useState("");
  // Imported games inherit this team's last settings — import a freshman
  // schedule and it arrives untracked, like the rest of their games.
  const [rosterId, setRosterId] = useState<string>(rosters.length === 1 ? rosters[0].id : "");
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
      const parsed: ImportRow[] = raw.trim().startsWith("BEGIN:VCALENDAR")
        ? parseICal(raw)                       // pasted feed contents still work
        : parsePastedTable(raw, seasonStartYear);
      if (!parsed.length) { setErr("Nothing to import — no rows found."); setRows(null); return; }
      setRows(await reconcile(parsed, season));
    } catch (e: any) {
      setErr(e.message);
      setRows(null);
    } finally { setBusy(false); }
  }

  async function commit() {
    if (!rows) return;
    setBusy(true);
    const { created, updated } = await commitImport(rows, season, seasonId, userId, rosterId || null);
    setBusy(false);
    onImported();
    onClose();
    window.alert(`Imported ${created} new game${created === 1 ? "" : "s"}${updated ? `, updated ${updated}` : ""}.`);
  }

  const counts = rows
    ? rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {} as Record<string, number>)
    : null;
  const willWrite = rows?.filter(r => r.status === "new" || r.status === "moved").length ?? 0;
  const needsTeam = rosters.length > 1 && !rosterId;

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Import schedule</h3>
          <button onClick={onClose} style={btn}>Cancel</button>
        </div>

        {/* Which team these games are for. Without it every imported game
            showed on every team's schedule, since a game with no team is
            treated as everyone's. */}
        <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>These games are for</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {rosters.map(r => (
            <button key={r.id} onClick={() => { setRosterId(r.id); setRows(null); }}
              style={rosterId === r.id ? chipActive : btn}>
              {r.name}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, lineHeight: 1.5 }}>
          Select the schedule rows on your league or school site and paste them here. Calendar feed contents work too.
        </div>
        <textarea
          value={raw} onChange={e => setRaw(e.target.value)} rows={7}
          placeholder={"Tue Dec 15 6:30 PM\t@\tFoxborough High School\tFoxboro HS — Gym"}
          style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 12, resize: "vertical" }}
        />

        <div style={{ marginTop: 10 }}>
          <button onClick={preview} disabled={busy || needsTeam} style={{ ...primary, opacity: busy || needsTeam ? 0.5 : 1 }}>
            {busy ? "Reading…" : "Preview"}
          </button>
          {needsTeam && <span style={{ fontSize: 11.5, color: "var(--muted)", alignSelf: "center" }}>Pick a team first.</span>}
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
                      <td style={td}>
                        {r.opponent || "—"}
                        {/* Which opponent it'll attach to. A page writing
                            "Foxboro" where your list says "Foxborough" is
                            only catchable by eye, so it's shown before you
                            commit rather than discovered later when a scout
                            sheet won't connect. */}
                        {r.status !== "problem" && (
                          r.opponentMatch
                            ? r.opponentMatch.trim().toLowerCase() !== r.opponent.trim().toLowerCase() && (
                                <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)" }}>→ {r.opponentMatch}</span>
                              )
                            : <span style={{ display: "block", fontSize: 10.5, color: "#e8a33d" }}>→ new opponent</span>
                        )}
                      </td>
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
