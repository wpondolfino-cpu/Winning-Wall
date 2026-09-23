// src/components/SeasonManager.tsx
//
// The one list of seasons, in Settings — where a program-wide thing
// belongs. It used to live on the Practices page as a single "+ New
// season" button, which could only ever create: there was no way to make
// an earlier season current again, and nothing showed what a season held.
//
// This is for MANAGING seasons, not reading them. Reports and "Where the
// time went" already have season selectors, and archived leaderboards have
// their own screen; a fourth view here would be three more things to keep
// in step. The counts are here so an accidental rollover is obvious and a
// real season can be told from a test one before it's deleted.
//
// Starting a season normally happens by flipping to offseason — that's
// when one actually ends. The button here is for the first one, or a
// correction.

import { useState, useEffect } from "react";
import {
  SeasonSummary, getSeasonSummaries, setCurrentSeason, updateSeason,
  deleteSeason, startNewSeason, nextSeasonNameAfter,
} from "../lib/practicePlanner";
import { inputStyle } from "../lib/inputStyle";

export default function SeasonManager() {
  const [seasons, setSeasons] = useState<SeasonSummary[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { setSeasons(await getSeasonSummaries()); }
    catch (e: any) { setErr(e.message); setSeasons([]); }
  }
  useEffect(() => { void load(); }, []);

  const current = seasons?.find(s => s.is_current) ?? null;

  async function run(fn: () => Promise<{ error: string | null }>) {
    setBusy(true); setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) { setErr(error); return; }
    setEditing(null);
    await load();
  }

  async function addSeason() {
    const name = window.prompt("Name the season", nextSeasonNameAfter(current?.name));
    if (!name?.trim()) return;
    setBusy(true);
    const { error } = await startNewSeason(name);
    setBusy(false);
    if (error) { setErr(error); return; }
    await load();
  }

  async function remove(s: SeasonSummary) {
    const holds = [s.games && `${s.games} game${s.games === 1 ? "" : "s"}`,
                   s.practices && `${s.practices} practice${s.practices === 1 ? "" : "s"}`]
      .filter(Boolean).join(" and ");
    const msg = holds
      // Nothing is deleted with it — losing a season shouldn't lose a year
      // of games.
      ? `Delete "${s.name}"? Its ${holds} stay, but stop belonging to a season until you place them.`
      : `Delete "${s.name}"?`;
    if (!window.confirm(msg)) return;
    await run(() => deleteSeason(s.id));
  }

  const dateLabel = (d: string | null) =>
    d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "no start date";

  return (
    <div style={{ background: "var(--surface2)", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Seasons</div>
        <button type="button" onClick={addSeason} disabled={busy}
          style={{ background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "6px 11px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          + Season
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        A season runs until the next one starts, so its start date is all that's needed.
        Practices, games and archives file themselves by date.
      </div>

      {err && <div className="error-msg" style={{ marginBottom: 10 }}>{err}</div>}
      {seasons === null && <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>}
      {seasons?.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No seasons yet.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {seasons?.map(s => (
          <div key={s.id} style={{
            border: `1px solid ${s.is_current ? "var(--gold)" : "var(--border)"}`,
            background: s.is_current ? "rgba(240,192,64,0.07)" : "transparent",
            borderRadius: 9, padding: "10px 12px",
          }}>
            {editing === s.id ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input value={draftName} onChange={e => setDraftName(e.target.value)}
                  style={{ ...inputStyle, flex: "1 1 140px", fontSize: 13, padding: "6px 9px" }} />
                <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
                  style={{ ...inputStyle, fontSize: 13, padding: "6px 9px" }} />
                <button type="button" disabled={busy} onClick={() => run(() => updateSeason(s.id, { name: draftName, start_date: draftDate }))}
                  style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "6px 11px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
                <button type="button" onClick={() => setEditing(null)}
                  style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "6px 11px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</span>
                  {s.is_current && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--gold)", letterSpacing: 0.5 }}>CURRENT</span>}
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>from {dateLabel(s.start_date)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                  {s.games} game{s.games === 1 ? "" : "s"} · {s.practices} practice{s.practices === 1 ? "" : "s"}
                  {s.archived && " · leaderboard archived"}
                  {!s.games && !s.practices && !s.archived && " — nothing in it yet"}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {!s.is_current && (
                    <button type="button" disabled={busy} onClick={() => run(() => setCurrentSeason(s.id))}
                      style={{ background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                      Make current
                    </button>
                  )}
                  <button type="button" onClick={() => { setEditing(s.id); setDraftName(s.name); setDraftDate(s.start_date ?? ""); }}
                    style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                    Rename or move
                  </button>
                  <button type="button" disabled={busy} onClick={() => remove(s)}
                    style={{ background: "none", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
