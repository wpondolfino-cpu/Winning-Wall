// src/components/stats/PlayerViewSettings.tsx
// Per team: whose box score lines players see, which stats, and which
// records go in the Hall of Fame. A player record can only be ticked for a
// stat players can see, so a record never gives away a hidden number.
import { useEffect, useState, type CSSProperties } from "react";
import {
  RECORD_DEFS, STAT_GROUPS, getStatSettings, saveStatSettings, type StatSettings, type Whose,
} from "../../lib/boxScores";
import { TEAM_RECORD_DEFS, recomputeTeamRecords } from "../../lib/teamRecords";

interface Props { rosterId: string; rosterName: string; onClose: () => void }

const head: CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "6px 0 4px" };
const row: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)" };
const desc: CSSProperties = { fontSize: 11, color: "var(--muted)", lineHeight: 1.45, marginTop: 2 };

const WHOSE: { key: Whose; label: string; text: string }[] = [
  { key: "off", label: "Off", text: "Players see no box scores." },
  { key: "own", label: "Only their own", text: "Each player sees their own line, on their Profile." },
  { key: "team", label: "The whole team", text: "Players also get the Players tab on game reports, with every teammate's line." },
];

export default function PlayerViewSettings({ rosterId, rosterName, onClose }: Props) {
  const [s, setS] = useState<StatSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getStatSettings(rosterId).then(setS).catch((e) => setErr(e?.message ?? "Couldn't load settings.")); }, [rosterId]);

  const toggle = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

  async function save() {
    if (!s) return;
    setBusy(true); setErr(null);
    try {
      await saveStatSettings(s);
      await recomputeTeamRecords(rosterId).catch(() => {});
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't save.");
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", overflowY: "auto" }}
      onClick={() => !busy && onClose()}>
      <div role="dialog" aria-label="Player view settings" onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: 620, maxWidth: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--title)", letterSpacing: 1, flex: 1 }}>What players see · {rosterName}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          Coaches always see everything. Changes apply right away, to every game already in — nothing is deleted, so ticking something back on brings it back.
        </div>

        {!s ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div> : (
          <>
            <div style={head}>Whose stats</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {WHOSE.map((w) => (
                <label key={w.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
                  <input type="radio" name="whose" checked={s.whose === w.key} onChange={() => setS({ ...s, whose: w.key })} style={{ marginTop: 3 }} />
                  <span><b>{w.label}</b><div style={desc}>{w.text}</div></span>
                </label>
              ))}
            </div>

            <div style={{ ...head, marginTop: 12 }}>Which stats players see</div>
            <div style={{ opacity: s.whose === "off" ? 0.5 : 1 }}>
              {STAT_GROUPS.map((g) => (
                <label key={g.key} style={{ ...row, cursor: "pointer" }}>
                  <input type="checkbox" checked={s.visible.includes(g.key)} onChange={() => setS({ ...s, visible: toggle(s.visible, g.key) })} style={{ marginTop: 3 }} />
                  <span><span style={{ fontSize: 13, fontWeight: 600 }}>{g.label}</span><div style={desc}>{g.description}</div></span>
                </label>
              ))}
            </div>

            <div style={{ ...head, marginTop: 12 }}>Hall of Fame · player game records</div>
            <div style={desc}>Best single game, regular season and postseason games only. Ties show every player. Only stats players can see can be ticked.</div>
            {RECORD_DEFS.map((r) => {
              const allowed = s.visible.includes(r.group) && s.whose !== "off";
              return (
                <label key={r.key} style={{ ...row, cursor: allowed ? "pointer" : "default", opacity: allowed ? 1 : 0.45 }}
                  title={allowed ? undefined : "Turn on this stat under \"Which stats players see\" first"}>
                  <input type="checkbox" disabled={!allowed} checked={allowed && s.hof.includes(r.key)} onChange={() => setS({ ...s, hof: toggle(s.hof, r.key) })} style={{ marginTop: 3 }} />
                  <span style={{ fontSize: 13 }}>{r.label}</span>
                </label>
              );
            })}

            <div style={{ ...head, marginTop: 12 }}>Hall of Fame · team records</div>
            <div style={desc}>From finished games, tracked possessions and box scores. Regular season and postseason games only.</div>
            {TEAM_RECORD_DEFS.map((r) => (
              <label key={r.key} style={{ ...row, cursor: "pointer" }}>
                <input type="checkbox" checked={s.team_hof.includes(r.key)} onChange={() => setS({ ...s, team_hof: toggle(s.team_hof, r.key) })} style={{ marginTop: 3 }} />
                <span><span style={{ fontSize: 13 }}>{r.label}</span><div style={desc}>{r.description}</div></span>
              </label>
            ))}
          </>
        )}

        {err && <div className="error-msg" style={{ marginBottom: 0 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{ background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
          <button className="btn-primary" style={{ width: "auto", padding: "8px 18px" }} disabled={busy || !s} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
