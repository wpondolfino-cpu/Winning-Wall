// src/components/scouting/ScoutSheetPrintView.tsx
import { useState, useMemo } from "react";
import { ScoutSheet, ScoutPlayer, ScoutOffenseSet, ScoutSpecial, updateScoutSheet } from "../../lib/scoutSheets";
import { DefenseSectionData } from "./DefenseSection";

interface Props {
  sheet: ScoutSheet;
  opponentName: string;
  gameDate: string | null;
  players: ScoutPlayer[];
  offenseSets: ScoutOffenseSet[];
  specials: ScoutSpecial[];
  primaryData: DefenseSectionData;
  secondaryData: DefenseSectionData;
  pressChips: string[]; pressPlan: string[];
  blobSlobDChips: string[]; blobSlobDPlan: string[];
  onSheetUpdated: () => void;
}

const PRINT_CAP = 9;

// Strips richtext markup down to a single condensed line for print —
// the full toolbar markup (bullets, numbers, dividers) is meant for
// on-screen reading; print needs one line per call, not the full
// multi-line breakdown.
function toOneLine(text: string | null, maxLen = 90): string {
  if (!text) return "";
  const flat = text
    .split("\n")
    .map(l => l.replace(/^\s*[-*]\s?/, "").replace(/^\s*\d+\.\s?/, "").trim())
    .filter(l => l && l !== "---")
    .join(" ")
    .replace(/\*\*(.+?)\*\*/g, "$1");
  return flat.length > maxLen ? flat.slice(0, maxLen - 1) + "…" : flat;
}

function summarizeDefense(d: DefenseSectionData | undefined): { look: string; attack: string } {
  if (!d || !d.base) return { look: "Not scouted", attack: "—" };
  if (d.base === "man") {
    const court = d.man.court ? (d.man.court === "full" ? "Full court" : "Half court") : "";
    const look = [court, ...d.man.structure, ...d.man.offBall, ...d.man.ballScreen].filter(Boolean).join(", ") || "Man";
    const attack = [...d.man.structurePlan, ...d.man.offBallPlan, ...d.man.ballScreenPlan].join(", ") || "—";
    return { look, attack };
  }
  const look = [...d.zone.type, ...d.zone.structure].join(", ") || "Zone";
  const attack = d.zone.plan.join(", ") || "—";
  return { look, attack };
}

function hasScoutingData(p: ScoutPlayer): boolean {
  return p.is_starter || p.markers.length > 0 || p.offensive_strengths.length > 0 ||
    p.defensive_strengths.length > 0 || p.plan_to_guard.length > 0 || p.plan_to_attack.length > 0 ||
    !!(p.notes && p.notes.trim());
}

export default function ScoutSheetPrintView({
  sheet, opponentName, gameDate, players, offenseSets, specials,
  primaryData, secondaryData, pressChips, pressPlan, blobSlobDChips, blobSlobDPlan, onSheetUpdated,
}: Props) {
  const scouted = useMemo(() => players.filter(hasScoutingData), [players]);
  const guaranteedIds = useMemo(() => new Set(scouted.filter(p => p.is_starter || p.markers.length > 0).map(p => p.id)), [scouted]);

  const needsPick = scouted.length > PRINT_CAP;

  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const prior = (sheet.print_selected_player_ids ?? []).filter(id => scouted.some(p => p.id === id));
    if (prior.length > 0) return prior;
    const guaranteed = scouted.filter(p => guaranteedIds.has(p.id)).map(p => p.id);
    const rest = scouted.filter(p => !guaranteedIds.has(p.id)).map(p => p.id);
    return [...guaranteed, ...rest].slice(0, PRINT_CAP);
  });

  const printPlayers = needsPick ? scouted.filter(p => selectedIds.includes(p.id)) : scouted;

  function togglePick(id: string) {
    if (guaranteedIds.has(id)) return; // locked
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= PRINT_CAP) return prev;
      return [...prev, id];
    });
  }

  async function confirmPicks() {
    await updateScoutSheet(sheet.id, { print_selected_player_ids: selectedIds });
    onSheetUpdated();
  }

  const primary = summarizeDefense(primaryData);
  const secondary = summarizeDefense(secondaryData);
  const pressLook = pressChips.join(", ") || "Not scouted";
  const pressAttack = pressPlan.join(", ") || "—";
  const blobSlobDLook = blobSlobDChips.join(", ") || "Not scouted";
  const blobSlobDAttack = blobSlobDPlan.join(", ") || "—";
  const keys = (sheet.keys_to_game ?? []).filter(Boolean);
  const mid = Math.ceil(keys.length / 2);
  const keyCols = [keys.slice(0, mid), keys.slice(mid)];

  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <button onClick={() => window.print()} style={{ padding: "8px 14px", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          🖨️ Print / Save as PDF
        </button>
        {needsPick && <span style={{ fontSize: 12, color: "var(--muted)" }}>{scouted.length} scouted players — showing {printPlayers.length} of a {PRINT_CAP} max on print</span>}
      </div>

      {needsPick && (
        <div className="no-print" style={{ background: "var(--surface2)", borderRadius: 10, padding: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Pick {PRINT_CAP} players for the printed sheet — starters and marked players are locked in.</div>
          {scouted.map(p => (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13, cursor: guaranteedIds.has(p.id) ? "default" : "pointer" }}>
              <input type="checkbox" checked={selectedIds.includes(p.id)} disabled={guaranteedIds.has(p.id)} onChange={() => togglePick(p.id)} />
              {p.markers.map(m => m === "star" ? "⭐" : m === "dart" ? "🎯" : "🐢").join(" ")} {p.name} — #{p.number ?? "—"}
            </label>
          ))}
          <button type="button" onClick={confirmPicks} style={{ marginTop: 10, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save selection</button>
        </div>
      )}

      {/* FRONT PAGE */}
      <div className="print-page" style={{ background: "#fff", color: "#111", padding: 18, borderRadius: 8, marginBottom: 24, fontSize: 11, lineHeight: 1.4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #111", paddingBottom: 6, marginBottom: 8 }}>
          <span>
            <strong style={{ fontSize: 13 }}>{opponentName.toUpperCase()}</strong>
            {sheet.team_record && <> ({sheet.team_record})</>}
            {sheet.tempo && <> · {sheet.tempo}</>}
          </span>
          <span>{gameDate ? new Date(gameDate).toLocaleDateString() : ""}</span>
        </div>

        {keys.length > 0 && (
          <div style={{ background: "#f5eddc", border: "1px solid #d8b45a", padding: "6px 8px", marginBottom: 10 }}>
            <strong style={{ fontSize: 11 }}>KEYS TO THE GAME</strong>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", marginTop: 4 }}>
              {keyCols.map((col, ci) => (
                <ol key={ci} start={ci === 0 ? 1 : mid + 1} style={{ margin: 0, paddingLeft: 16 }}>
                  {col.map((k, i) => (
                    <li key={i} dangerouslySetInnerHTML={{ __html: k.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>") }} />
                  ))}
                </ol>
              ))}
            </div>
          </div>
        )}

        <strong style={{ fontSize: 11 }}>ROSTER {scouted.length > printPlayers.length ? "(scouted players only)" : ""}</strong>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #999", textAlign: "left" }}>
              <th>#</th><th>Name</th><th>Pos</th><th>Ht</th><th>Gr</th><th>H</th><th>Assigned</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {printPlayers.map(p => (
              <tr key={p.id}>
                <td>{p.number ?? "—"}</td>
                <td>{p.markers.length > 0 ? (p.markers.includes("star") ? "★ " : p.markers.includes("dart") ? "◎ " : "") : ""}{p.name}</td>
                <td>{p.position ?? "—"}</td>
                <td>{p.height ?? "—"}</td>
                <td>{p.grade ?? "—"}</td>
                <td>{p.dominant_hand ?? "—"}</td>
                <td>{p.assigned_to_profile_id ? "Assigned" : "—"}</td>
                <td>{[...p.offensive_strengths, ...p.plan_to_attack].slice(0, 2).join(", ") || (p.notes ?? "").slice(0, 40)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* BACK PAGE */}
      <div className="print-page" style={{ background: "#fff", color: "#111", padding: 18, borderRadius: 8, fontSize: 11, lineHeight: 1.4 }}>
        <strong style={{ fontSize: 11 }}>OFFENSE — FAVORITE SETS</strong>
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "4px 0 10px" }}>
          <tbody>
            {offenseSets.map(s => (
              <tr key={s.id}>
                <td style={{ width: "18%", fontWeight: 600, verticalAlign: "top" }}>{s.call_name}</td>
                <td style={{ verticalAlign: "top" }}>{toOneLine(s.description)}</td>
                <td style={{ verticalAlign: "top" }}>{toOneLine(s.plan_to_defend)}</td>
              </tr>
            ))}
            {offenseSets.length === 0 && <tr><td style={{ color: "#888" }}>None entered</td></tr>}
          </tbody>
        </table>

        <strong style={{ fontSize: 11 }}>SPECIALS</strong>
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "4px 0 10px" }}>
          <tbody>
            {specials.map(s => (
              <tr key={s.id}>
                <td style={{ width: "18%", fontWeight: 600, verticalAlign: "top" }}>{s.kind.toUpperCase()} — {s.call_name}</td>
                <td style={{ verticalAlign: "top" }}>{toOneLine(s.description)}</td>
                <td style={{ verticalAlign: "top" }}>{toOneLine(s.plan_to_defend)}</td>
              </tr>
            ))}
            {specials.length === 0 && <tr><td style={{ color: "#888" }}>None entered</td></tr>}
          </tbody>
        </table>

        <strong style={{ fontSize: 11 }}>DEFENSE</strong>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
          <tbody>
            <tr><td style={{ width: "18%", fontWeight: 600, verticalAlign: "top" }}>Primary</td><td colSpan={2}>{primary.look}. Attack: {primary.attack}.</td></tr>
            <tr><td style={{ fontWeight: 600, verticalAlign: "top" }}>Secondary</td><td colSpan={2}>{secondary.look}. Attack: {secondary.attack}.</td></tr>
            <tr><td style={{ fontWeight: 600, verticalAlign: "top" }}>Press</td><td colSpan={2}>{pressLook}. Attack: {pressAttack}.</td></tr>
            <tr><td style={{ fontWeight: 600, verticalAlign: "top" }}>BLOB/SLOB D</td><td colSpan={2}>{blobSlobDLook}. Attack: {blobSlobDAttack}.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
