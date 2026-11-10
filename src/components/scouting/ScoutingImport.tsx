// src/components/scouting/ScoutingImport.tsx
// The Scouting Calendar's three ways in:
//   PasteGamesModal  -- paste games from a schedule page or a spreadsheet
//   AddGameModal     -- one game by hand
//   RankingsModal    -- paste MIAA power rankings (divisions and ranks)
// Each shows what it understood before anything is saved.

import { useMemo, useState } from "react";
import { inputStyle } from "../../lib/inputStyle";
import {
  ParsedGame, parseScoutingPaste, addScoutingGames, getScoutingGames, gameKey, teamKey, Ranking, parseRankingsPaste, saveRankings,
} from "../../lib/scoutingCalendar";

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 };
const box: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 880, maxHeight: "90vh", overflowY: "auto" };
const primary: React.CSSProperties = { background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13 };
const plain: React.CSSProperties = { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 };
const cell: React.CSSProperties = { padding: "6px 8px", borderTop: "1px solid var(--border)", fontSize: 12.5, verticalAlign: "middle" };
const small: React.CSSProperties = { ...inputStyle, padding: "5px 8px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };

function Shell({ title, sub, onClose, children }: { title: string; sub: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{sub}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ marginTop: 14 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Paste games ──────────────────────────────────────────────
export function PasteGamesModal({ onClose, onSaved }: { onClose: () => void; onSaved: (firstDate: string | null) => void }) {
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<ParsedGame[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Games already on the calendar, to flag repeats before saving.
  const [existing, setExisting] = useState<Set<string>>(new Set());
  // A row is a repeat if it's on the calendar already or earlier in this paste.
  const dupes = useMemo(() => {
    const seen = new Set(existing);
    return (rows ?? []).map(r => {
      if (r.problem) return false;
      const k = gameKey(r);
      const d = seen.has(k); seen.add(k); return d;
    });
  }, [rows, existing]);
  const good = (rows ?? []).filter((r, i) => !r.problem && !dupes[i]);

  async function read() {
    const parsed = parseScoutingPaste(raw);
    const dates = parsed.map(r => r.game_date).filter(Boolean).sort();
    try {
      setExisting(new Set(dates.length ? (await getScoutingGames(dates[0], dates[dates.length - 1])).map(gameKey) : []));
    } catch { setExisting(new Set()); }
    setRows(parsed);
  }
  const update = (i: number, patch: Partial<ParsedGame>) => setRows(rs => (rs ?? []).map((r, j) => {
    if (j !== i) return r;
    const n = { ...r, ...patch };
    n.problem = !n.away_team.trim() || !n.home_team.trim() ? "needs two teams" : !n.game_date ? "no date" : null;
    return n;
  }));

  async function save() {
    setBusy(true); setErr(null);
    const res = await addScoutingGames(good);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    alert(`Added ${res.added} game${res.added === 1 ? "" : "s"}${res.skipped ? ` (${res.skipped} already on the calendar)` : ""}.`);
    onSaved(good.map(g => g.game_date).sort()[0] ?? null);
  }

  return (
    <Shell title="Paste games" sub="Copy games from a schedule page or your spreadsheet and paste them here. You'll see what was read before anything is saved." onClose={onClose}>
      {!rows ? (
        <>
          <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={10} autoFocus
            placeholder={"Any of these work, one game per line:\n\nTue 12/15   Lowell   Cambridge   7:00\nLowell at Cambridge 7:00 PM\nCambridge vs Lowell 7pm\n\nA line with only a date (Wednesday 12/16) sets the date for the games under it."}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }} />
          <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 12px" }}>
            Spreadsheet columns: away team first, then home, then location if it's a neutral site. "High School" is dropped from names so they match. Don't know the opponent yet? Put TBA. "A at B" means B is home; "A vs B" means A is home. A time with no AM/PM is read as evening.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={plain} onClick={onClose}>Cancel</button>
            <button type="button" style={primary} disabled={!raw.trim()} onClick={read}>Read games →</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12.5, marginBottom: 8 }}>
            <b>{good.length}</b> new game{good.length === 1 ? "" : "s"} ready
            {dupes.filter(Boolean).length > 0 && <span style={{ color: "var(--muted)" }}> · {dupes.filter(Boolean).length} duplicate{dupes.filter(Boolean).length === 1 ? "" : "s"} skipped</span>}
            {rows.filter(r => r.problem).length > 0 && <span style={{ color: "var(--gold-text)" }}> · {rows.filter(r => r.problem).length} need fixing</span>}
            . Fix anything that's wrong right here; ⇄ swaps home and away. Location is only for a neutral site.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr style={{ fontSize: 11, color: "var(--muted)", textAlign: "left" }}>
                <th style={{ padding: "4px 8px" }}>Date</th><th style={{ padding: "4px 8px" }}>Time</th><th style={{ padding: "4px 8px" }}>Away</th><th></th><th style={{ padding: "4px 8px" }}>Home</th><th style={{ padding: "4px 8px" }}>Location</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} title={dupes[i] ? "This game is already on the calendar (or earlier in this paste), so it won't be added again" : undefined}
                    style={{ background: r.problem ? "rgba(240,192,64,0.08)" : undefined, opacity: dupes[i] ? 0.45 : 1 }}>
                    <td style={{ ...cell, width: 130 }}><input type="date" value={r.game_date} onChange={e => update(i, { game_date: e.target.value })} style={small} /></td>
                    <td style={{ ...cell, width: 104 }}><input type="time" value={r.tip_time ?? ""} onChange={e => update(i, { tip_time: e.target.value || null })} style={small} /></td>
                    <td style={cell}><input value={r.away_team} onChange={e => update(i, { away_team: e.target.value })} style={small} /></td>
                    <td style={{ ...cell, width: 30, textAlign: "center" }}>
                      <button type="button" title="Swap home and away" onClick={() => update(i, { away_team: r.home_team, home_team: r.away_team })}
                        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--muted)", cursor: "pointer", padding: "2px 6px" }}>⇄</button>
                    </td>
                    <td style={cell}><input value={r.home_team} onChange={e => update(i, { home_team: e.target.value })} style={small} /></td>
                    <td style={cell}>
                      {dupes[i]
                        ? <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>Duplicate · skipped</span>
                        : <input value={r.location ?? ""} onChange={e => update(i, { location: e.target.value || null })} placeholder="Home gym" style={small} />}
                    </td>
                    <td style={{ ...cell, width: 30 }}>
                      <button type="button" title="Leave this one out" onClick={() => setRows(rs => (rs ?? []).filter((_, j) => j !== i))}
                        style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 15 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.some(r => r.problem) && (
            <div style={{ fontSize: 11.5, color: "var(--gold-text)", marginTop: 8 }}>
              Highlighted rows {rows.filter(r => r.problem).map(r => `"${r.raw.slice(0, 40)}"`).slice(0, 3).join(", ")}{rows.filter(r => r.problem).length > 3 ? "…" : ""} weren't read fully and won't be saved unless you fill them in.
            </div>
          )}
          {err && <div className="error-msg" style={{ marginTop: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 14 }}>
            <button type="button" style={plain} onClick={() => setRows(null)}>← Back to the paste</button>
            <button type="button" style={primary} disabled={busy || !good.length} onClick={save}>{busy ? "Saving…" : `Save ${good.length} game${good.length === 1 ? "" : "s"}`}</button>
          </div>
        </>
      )}
    </Shell>
  );
}

// ── One game by hand ─────────────────────────────────────────
export function AddGameModal({ defaultDate, onClose, onSaved }: { defaultDate: string; onClose: () => void; onSaved: (date: string) => void }) {
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("19:00");
  const [away, setAway] = useState("");
  const [home, setHome] = useState("");
  const [loc, setLoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = date && away.trim() && home.trim();

  async function save() {
    setBusy(true); setErr(null);
    const res = await addScoutingGames([{ game_date: date, tip_time: time || null, away_team: away, home_team: home, location: loc || null }]);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    if (!res.added) { setErr("That game is already on the calendar."); return; }
    onSaved(date);
  }

  const label: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 };
  return (
    <Shell title="Add a game" sub="A game you want scouted that isn't on the calendar yet." onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span style={label}>Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} /></label>
        <label><span style={label}>Tip time</span><input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} /></label>
        <label><span style={label}>Away team</span><input value={away} onChange={e => setAway(e.target.value)} placeholder="Team, or TBA" autoFocus style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} /></label>
        <label><span style={label}>Home team</span><input value={home} onChange={e => setHome(e.target.value)} placeholder="Team, or TBA" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} /></label>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Location — only if it isn't at the home team's gym (tournaments: the site)</span>
          <input value={loc} onChange={e => setLoc(e.target.value)} placeholder="e.g. a neutral site or tournament" maxLength={80} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} /></label>
      </div>
      {err && <div className="error-msg" style={{ marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" style={plain} onClick={onClose}>Cancel</button>
        <button type="button" style={primary} disabled={busy || !ok} onClick={save}>{busy ? "Saving…" : "Add game"}</button>
      </div>
    </Shell>
  );
}

// ── Rankings ─────────────────────────────────────────────────
export function RankingsModal({ current, scheduleTeams, onClose, onSaved }: {
  current: Ranking[];
  /** Every team name on the calendar, to flag rankings names that won't match. */
  scheduleTeams: string[];
  onClose: () => void; onSaved: () => void;
}) {
  const [division, setDivision] = useState(1);
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<Ranking[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const known = useMemo(() => new Set(scheduleTeams.map(teamKey)), [scheduleTeams]);
  const byDiv = useMemo(() => {
    const m = new Map<number, number>();
    current.forEach(r => m.set(r.division, (m.get(r.division) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [current]);

  async function save() {
    if (!rows) return;
    setBusy(true); setErr(null);
    const res = await saveRankings(rows.filter(r => r.team.trim()));
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    onSaved();
  }

  const divs = Array.from(new Set((rows ?? []).map(r => r.division))).sort();
  return (
    <Shell title="MIAA rankings" sub="Open the MIAA power rankings for a division, select the list, copy and paste it here. Paste again each week to update." onClose={onClose}>
      {byDiv.length > 0 && !rows && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          On file: {byDiv.map(([d, n]) => `D${d} (${n} teams)`).join(" · ")}
        </div>
      )}
      {!rows ? (
        <>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Division</span>
            {[1, 2, 3, 4, 5].map(d => (
              <button key={d} type="button" onClick={() => setDivision(d)}
                style={{ fontSize: 12, padding: "5px 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
                  background: division === d ? "var(--royal)" : "var(--surface2)", color: division === d ? "#fff" : "var(--text)",
                  border: division === d ? "1px solid var(--royal)" : "1px solid var(--border)" }}>D{d}</button>
            ))}
          </div>
          <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={10} autoFocus
            placeholder={"1  Springfield Central  14-1  0.933\n2  Central Catholic  13-2  0.866\n3  Natick  12-3 …\n\nA \"Division 2\" line partway down switches division, so you can paste several at once."}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }} />
          {err && <div className="error-msg" style={{ marginTop: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" style={plain} onClick={onClose}>Cancel</button>
            <button type="button" style={primary} disabled={!raw.trim()} onClick={() => {
              const parsed = parseRankingsPaste(raw, division);
              if (!parsed.length) { setErr("No ranked teams found. Each line should start with the rank, then the team."); return; }
              setErr(null); setRows(parsed);
            }}>Read rankings →</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12.5, marginBottom: 8 }}>
            <b>{rows.length}</b> teams in {divs.map(d => `D${d}`).join(", ")}. Saving replaces {divs.length === 1 ? "that division's" : "those divisions'"} rankings.
            {" "}A name in <span style={{ color: "var(--gold-text)" }}>gold</span> isn't on the calendar yet. If the schedule spells it differently ("BR" for Bridgewater-Raynham), change it here to match.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ fontSize: 11, color: "var(--muted)", textAlign: "left" }}>
                <th style={{ padding: "4px 8px" }}>Div</th><th style={{ padding: "4px 8px" }}>Rank</th><th style={{ padding: "4px 8px" }}>Team</th><th style={{ padding: "4px 8px" }}>Record</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const match = known.has(teamKey(r.team));
                  const set = (p: Partial<Ranking>) => setRows(rs => (rs ?? []).map((x, j) => j === i ? { ...x, ...p } : x));
                  return (
                    <tr key={i}>
                      <td style={{ ...cell, width: 44 }}>D{r.division}</td>
                      <td style={{ ...cell, width: 64 }}><input type="number" min={1} value={r.rank ?? ""} onChange={e => set({ rank: e.target.value ? parseInt(e.target.value, 10) : null })} style={small} /></td>
                      <td style={cell}><input value={r.team} onChange={e => set({ team: e.target.value })} style={{ ...small, color: match ? "var(--text)" : "var(--gold-text)" }} /></td>
                      <td style={{ ...cell, width: 70, color: "var(--muted)" }}>{r.record ?? "—"}</td>
                      <td style={{ ...cell, width: 30 }}>
                        <button type="button" title="Leave this one out" onClick={() => setRows(rs => (rs ?? []).filter((_, j) => j !== i))}
                          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 15 }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {err && <div className="error-msg" style={{ marginTop: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 14 }}>
            <button type="button" style={plain} onClick={() => setRows(null)}>← Back to the paste</button>
            <button type="button" style={primary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save rankings"}</button>
          </div>
        </>
      )}
    </Shell>
  );
}
