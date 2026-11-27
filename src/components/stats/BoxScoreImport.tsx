// src/components/stats/BoxScoreImport.tsx
// Put a game's player box score in: from Hudl's box score export, or typed
// in by hand. Jersey numbers are matched to the team's roster (plus anyone
// called up for this game), with a preview to confirm before saving.
// Saving replaces whatever box score the game already had.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { listGamePlayers, type LineupPlayer } from "../../lib/lineups";
import {
  COUNT_KEYS, emptyCounts, getBoxLines, lineProblem, parseBoxScoreFile, pastJerseyPicks, saveBoxScore, sumCounts,
  type BoxCounts, type BoxLine, type CountKey, type BoxMeta,
} from "../../lib/boxScores";
import { inputStyle } from "../../lib/inputStyle";

interface Props {
  gameId: string;
  rosterId: string | null;
  seasonId: string | null;
  opponent: string;
  existing: BoxMeta | null;
  onClose: () => void;
  onSaved: () => void;
}

type Row = BoxCounts & { key: string; jersey: number | null; player_id: string | null; name: string };

const NOT_ON_ROSTER = "__none__";
const HAND_COLS: { key: CountKey; label: string }[] = [
  { key: "pts", label: "Pts" }, { key: "fgm2", label: "2PM" }, { key: "fga2", label: "2PA" },
  { key: "fgm3", label: "3PM" }, { key: "fga3", label: "3PA" }, { key: "ftm", label: "FTM" }, { key: "fta", label: "FTA" },
  { key: "oreb", label: "OREB" }, { key: "dreb", label: "DREB" }, { key: "ast", label: "Ast" }, { key: "stl", label: "Stl" },
  { key: "blk", label: "Blk" }, { key: "defl", label: "Defl" }, { key: "chg", label: "Chg" }, { key: "tov", label: "TO" }, { key: "pf", label: "PF" },
];

const btn: CSSProperties = {
  background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "8px 14px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const th: CSSProperties = { fontSize: 11, color: "var(--muted)", fontWeight: 600, padding: "6px 4px", textAlign: "right", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const td: CSSProperties = { fontSize: 12, padding: "5px 4px", textAlign: "right", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const chip = (ok: boolean): CSSProperties => ({
  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap",
  background: ok ? "rgba(40,180,80,0.15)" : "rgba(240,192,64,0.15)", color: ok ? "var(--success-text, #6fd38a)" : "var(--gold-text, #f0c040)",
});

let keySeq = 0;
const newKey = () => `r${++keySeq}`;

export default function BoxScoreImport({ gameId, rosterId, seasonId, opponent, existing, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<"hudl" | "hand">(existing?.source ?? "hudl");
  const [team, setTeam] = useState<LineupPlayer[]>([]);
  const [everyone, setEveryone] = useState<LineupPlayer[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [shared, setShared] = useState(existing?.shared ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listGamePlayers(rosterId, gameId), listGamePlayers(null)])
      .then(async ([t, all]) => {
        setTeam(t);
        setEveryone(all);
        // Start from the saved box score when there is one.
        if (existing) {
          const lines = await getBoxLines(gameId);
          setRows(lines.map((l) => ({ ...pickCounts(l), key: newKey(), jersey: l.jersey, player_id: l.player_id, name: l.name ?? "" })));
        } else {
          setRows(handRows(t));
        }
      })
      .catch((e) => setErr(e?.message ?? "Couldn't load the roster."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const byId = useMemo(() => new Map(everyone.map((p) => [p.id, p])), [everyone]);
  const teamIds = useMemo(() => new Set(team.map((p) => p.id)), [team]);

  function handRows(t: LineupPlayer[]): Row[] {
    return t.map((p) => ({ ...emptyCounts(), key: newKey(), jersey: p.jersey, player_id: p.id, name: "" }));
  }

  async function readFile(file: File) {
    setErr(null); setFileNote(null);
    const text = await file.text();
    const parsed = parseBoxScoreFile(text);
    if (parsed.problems.length && !parsed.lines.length) { setErr(parsed.problems.join(" ")); return; }
    const past = await pastJerseyPicks(rosterId, seasonId);
    const used = new Set<string>();
    const next: Row[] = parsed.lines.map((l) => {
      const onTeam = team.find((p) => p.jersey != null && p.jersey === l.jersey);
      const remembered = l.jersey != null ? past.get(l.jersey) : undefined;
      let pid = onTeam?.id ?? remembered ?? null;
      if (pid && used.has(pid)) pid = null;
      if (pid) used.add(pid);
      const { jersey, ...counts } = l;
      return { ...(counts as BoxCounts), key: newKey(), jersey, player_id: pid, name: "" };
    });
    setRows(next);
    setFileName(file.name);
    setMode("hudl");
    const notes = [...parsed.problems];
    if (parsed.ignored.length) notes.push(`Columns not used: ${parsed.ignored.join(", ")}.`);
    setFileNote(notes.length ? notes.join(" ") : null);
  }

  const setCell = (key: string, k: CountKey, v: string) =>
    setRows((rs) => rs.map((r) => {
      if (r.key !== key) return r;
      const n = Math.max(0, Math.min(999, parseInt(v, 10) || 0));
      const next = { ...r, [k]: n } as Row;
      if (k === "oreb" || k === "dreb") next.reb = next.oreb + next.dreb;
      // Typing makes and free throws fills in points; typing points yourself overrides it.
      if (mode === "hand" && (k === "fgm2" || k === "fgm3" || k === "ftm")) next.pts = 2 * next.fgm2 + 3 * next.fgm3 + next.ftm;
      return next;
    }));
  const setPlayer = (key: string, pid: string) =>
    setRows((rs) => rs.map((r) => r.key === key ? { ...r, player_id: pid === NOT_ON_ROSTER ? null : pid } : r));

  const totals = sumCounts(rows);
  const dupes = (() => {
    const seen = new Map<string, number>();
    rows.forEach((r) => { if (r.player_id) seen.set(r.player_id, (seen.get(r.player_id) ?? 0) + 1); });
    return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
  })();
  const problems = rows.map((r) => lineProblem(r));
  const unmatched = rows.filter((r) => !r.player_id).length;

  async function save() {
    setErr(null);
    const live = mode === "hand" ? rows.filter((r) => COUNT_KEYS.some((k) => r[k] > 0) || !r.player_id) : rows;
    if (!live.length) { setErr("There's nothing to save yet."); return; }
    const bad = live.map((r) => [r, lineProblem(r)] as const).find(([, p]) => p);
    if (bad) { setErr(`${label(bad[0])}: ${bad[1]}`); return; }
    if (dupes.size) { setErr("The same player is picked on two lines."); return; }
    setBusy(true);
    try {
      const lines: BoxLine[] = live.map((r) => ({
        ...pickCounts(r), player_id: r.player_id, jersey: r.jersey,
        name: r.player_id ? null : (r.name.trim() || (r.jersey != null ? `#${r.jersey}` : "Not on roster")),
      }));
      await saveBoxScore(gameId, mode, shared, lines);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't save the box score.");
      setBusy(false);
    }
  }

  function label(r: Row) {
    const p = r.player_id ? byId.get(r.player_id) : null;
    return p ? `${p.jersey != null ? `#${p.jersey} ` : ""}${p.name}` : r.jersey != null ? `#${r.jersey}` : "A line";
  }

  const playerSelect = (r: Row) => (
    <select value={r.player_id ?? NOT_ON_ROSTER} onChange={(e) => setPlayer(r.key, e.target.value)} aria-label="Player"
      style={{ ...inputStyle, padding: "5px 6px", fontSize: 12, maxWidth: 190, borderColor: !r.player_id || (r.player_id && dupes.has(r.player_id)) ? "var(--gold, #f0c040)" : "var(--border)" }}>
      <option value={NOT_ON_ROSTER}>Not on roster (team totals only)</option>
      <optgroup label="This team">
        {team.map((p) => <option key={p.id} value={p.id}>{p.jersey != null ? `#${p.jersey} ` : ""}{p.name}{p.called_up ? " (called up)" : ""}</option>)}
      </optgroup>
      <optgroup label="Other players">
        {everyone.filter((p) => !teamIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.jersey != null ? `#${p.jersey} ` : ""}{p.name}</option>)}
      </optgroup>
    </select>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", overflowY: "auto" }}
      onClick={() => !busy && onClose()}>
      <div role="dialog" aria-label="Box score" onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: 900, maxWidth: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--title)", letterSpacing: 1, flex: 1 }}>Box score · vs {opponent}</div>
          <button onClick={onClose} disabled={busy} aria-label="Close" style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        <div className="role-tabs" style={{ marginBottom: 0 }}>
          <button className={`role-tab ${mode === "hudl" ? "active" : ""}`} onClick={() => setMode("hudl")}>📥 Hudl file</button>
          <button className={`role-tab ${mode === "hand" ? "active" : ""}`} onClick={() => { if (mode !== "hand" && !rows.length) setRows(handRows(team)); setMode("hand"); }}>✏️ Enter by hand</button>
        </div>

        {existing && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            This game already has a box score ({existing.source === "hudl" ? "from Hudl" : "typed in"}, {new Date(existing.saved_at).toLocaleDateString()}). Saving replaces it.
          </div>
        )}

        {mode === "hudl" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              In Hudl: open the game's Reports → Box Score → Export (it may say "MaxPreps"). Then choose that file here.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }}>
                📄 Choose file
                <input type="file" accept=".txt,.csv,text/plain,text/csv" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
              </label>
              {fileName && <span style={{ fontSize: 12, color: "var(--muted)" }}>{fileName}</span>}
              {fileName && <span style={chip(problems.every((p) => !p))}>{rows.length} players · {totals.pts} pts{problems.every((p) => !p) ? " · checks out" : " · check the yellow lines"}</span>}
            </div>
            {fileNote && <div style={{ fontSize: 11, color: "var(--muted)" }}>{fileNote}</div>}
          </div>
        )}

        {mode === "hudl" && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead><tr>
                <th style={{ ...th, textAlign: "left" }}>#</th><th style={{ ...th, textAlign: "left" }}>Player</th>
                <th style={th}>Pts</th><th style={th}>FG</th><th style={th}>3P</th><th style={th}>FT</th><th style={th}>Reb</th><th style={th}>Ast</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} style={{ background: problems[i] || !r.player_id ? "rgba(240,192,64,0.06)" : undefined }}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.jersey ?? "–"}</td>
                    <td style={{ ...td, textAlign: "left" }}>{playerSelect(r)}</td>
                    <td style={td}>{r.pts}</td>
                    <td style={td}>{r.fgm2 + r.fgm3}-{r.fga2 + r.fga3}</td>
                    <td style={td}>{r.fgm3}-{r.fga3}</td>
                    <td style={td}>{r.ftm}-{r.fta}</td>
                    <td style={td}>{r.reb}</td>
                    <td style={td}>{r.ast}</td>
                    <td style={td}>
                      {problems[i] ? <span style={chip(false)} title={problems[i]!}>{problems[i]}</span>
                        : r.player_id && dupes.has(r.player_id) ? <span style={chip(false)}>picked twice</span>
                        : r.player_id ? <span style={chip(true)}>{teamIds.has(r.player_id) ? "matched" : "other team"}</span>
                        : <span style={chip(false)}>{r.jersey != null ? `no #${r.jersey} on roster` : "pick a player"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unmatched > 0 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                Lines left as "Not on roster" still count in team totals but don't show on anyone's profile. A pick is remembered for this team the rest of the season.
              </div>
            )}
          </div>
        )}

        {mode === "hand" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 860 }}>
              <thead><tr>
                <th style={{ ...th, textAlign: "left" }}>Player</th>
                {HAND_COLS.map((c) => <th key={c.key} style={th}>{c.label}</th>)}
                <th style={th}>Reb</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td style={{ ...td, textAlign: "left" }}>{playerSelect(r)}</td>
                    {HAND_COLS.map((c) => (
                      <td key={c.key} style={{ ...td, padding: "3px 2px" }}>
                        <input inputMode="numeric" value={r[c.key] || ""} placeholder="0" aria-label={`${label(r)} ${c.label}`}
                          onChange={(e) => setCell(r.key, c.key, e.target.value)}
                          style={{ ...inputStyle, width: 40, padding: "5px 4px", textAlign: "right", fontSize: 12 }} />
                      </td>
                    ))}
                    <td style={{ ...td, color: "var(--muted)" }}>{r.reb}</td>
                    <td style={td}>{problems[i] ? <span style={chip(false)} title={problems[i]!}>!</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <button style={btn} onClick={() => setRows((rs) => [...rs, { ...emptyCounts(), key: newKey(), jersey: null, player_id: null, name: "" }])}>+ Add a line</button>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Points fill in from makes; change them if you need to. Players left at all zeros aren't saved.</span>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Team: {totals.pts} pts · FG {totals.fgm2 + totals.fgm3}-{totals.fga2 + totals.fga3} · 3P {totals.fgm3}-{totals.fga3} · FT {totals.ftm}-{totals.fta} · {totals.reb} reb · {totals.ast} ast · {totals.tov} TO
          </div>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)" }}>
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Players can see this box score (only what your Player view settings allow)
        </label>

        {err && <div className="error-msg" style={{ marginBottom: 0 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={btn} disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ width: "auto", padding: "8px 18px" }} disabled={busy || !rows.length} onClick={save}>
            {busy ? "Saving…" : existing ? "Replace box score" : "Save box score"}
          </button>
        </div>
      </div>
    </div>
  );
}

function pickCounts(r: Partial<BoxCounts>): BoxCounts {
  const out = emptyCounts();
  COUNT_KEYS.forEach((k) => (out[k] = Number(r[k] ?? 0)));
  return out;
}
