// src/components/ArchivedSeasons.tsx
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

interface OffseasonRow {
  player_id: string; season_label: string; overall_rank: number | null; group_rank: number | null;
  grade_category: string | null; total_points: number; drill_wins: number; h2h_wins: number;
}
interface InSeasonRow {
  player_id: string; season_label: string; overall_rank: number | null; roster_rank: number | null;
  roster_name: string | null; total_wins: number;
}
interface PlayerName { id: string; name: string; }

function toCsv(rows: any[], headers: string[]): string {
  return [headers, ...rows].map(r => r.map((v: any) => `"${v ?? ""}"`).join(",")).join("\n");
}
function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

export default function ArchivedSeasons() {
  const [labels, setLabels] = useState<string[]>([]);
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<"offseason" | "inseason">("offseason");
  const [offRows, setOffRows] = useState<OffseasonRow[]>([]);
  const [inRows, setInRows] = useState<InSeasonRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLabels = useCallback(async () => {
    const [{ data: sh }, { data: ih }] = await Promise.all([
      supabase.from("season_history").select("season_label"),
      supabase.from("inseason_history").select("season_label"),
    ]);
    const all = new Set<string>([...(sh ?? []).map((r: any) => r.season_label), ...(ih ?? []).map((r: any) => r.season_label)]);
    setLabels(Array.from(all).sort().reverse());
  }, []);

  useEffect(() => { loadLabels().catch(console.error); }, [loadLabels]);

  async function openArchive(label: string) {
    setOpenLabel(label);
    setSubTab("offseason");
    const [{ data: off }, { data: inn }, { data: players }] = await Promise.all([
      supabase.from("season_history").select("*").eq("season_label", label).order("overall_rank"),
      supabase.from("inseason_history").select("*").eq("season_label", label).order("overall_rank"),
      supabase.from("profiles").select("id, name"),
    ]);
    setOffRows(off ?? []);
    setInRows(inn ?? []);
    const nameMap: Record<string, string> = {};
    (players ?? []).forEach((p: PlayerName) => { nameMap[p.id] = p.name; });
    setNames(nameMap);
  }

  function exportCurrent() {
    if (!openLabel) return;
    if (subTab === "offseason") {
      const csv = toCsv(
        offRows.map(r => [names[r.player_id] ?? r.player_id, r.overall_rank, r.grade_category, r.total_points, r.drill_wins, r.h2h_wins]),
        ["Name", "Overall Rank", "Grade", "Total Points", "Drill Wins", "H2H Wins"]
      );
      downloadCsv(csv, `offseason-${openLabel}.csv`);
    } else {
      const csv = toCsv(
        inRows.map(r => [names[r.player_id] ?? r.player_id, r.overall_rank, r.roster_name, r.total_wins]),
        ["Name", "Overall Rank", "Roster", "Total Wins"]
      );
      downloadCsv(csv, `inseason-${openLabel}.csv`);
    }
  }

  async function confirmDeleteLabel(label: string) {
    setError(null);
    try {
      await Promise.all([
        supabase.from("season_history").delete().eq("season_label", label),
        supabase.from("inseason_history").delete().eq("season_label", label),
      ]);
      setConfirmDelete(null);
      setConfirmChecked(false);
      setOpenLabel(null);
      loadLabels();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't delete — try again.");
    }
  }

  if (openLabel) {
    const rows = subTab === "offseason" ? offRows : inRows;
    return (
      <div>
        <button type="button" onClick={() => setOpenLabel(null)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>← All archives</button>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{openLabel}</div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {(["offseason", "inseason"] as const).map(t => (
            <button key={t} onClick={() => setSubTab(t)} style={{
              flex: 1, padding: "8px 4px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
              background: subTab === t ? "var(--royal)" : "var(--surface2)", color: subTab === t ? "#fff" : "var(--muted)",
            }}>{t === "offseason" ? "Offseason" : "In-season"}</button>
          ))}
        </div>

        <button type="button" onClick={exportCurrent} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 14 }}>
          ⬇️ Export CSV
        </button>

        {rows.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>No {subTab} data in this archive.</div>
        ) : (
          <div>
            {rows.map((r: any, i: number) => (
              <div key={r.player_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px", borderTop: i > 0 ? "1px solid var(--border)" : "none", fontSize: 13 }}>
                <span style={{ width: 24, color: "var(--muted)" }}>{r.overall_rank ?? "—"}</span>
                <span style={{ flex: 1 }}>{names[r.player_id] ?? "Unknown"}</span>
                <span style={{ fontWeight: 700 }}>{subTab === "offseason" ? r.total_points : r.total_wins}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}
      {labels.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "24px 0", fontSize: 13 }}>No archived seasons yet.</div>
      ) : (
        labels.map(label => (
          <div key={label} style={{ background: "var(--surface2)", borderRadius: 10, padding: "10px 12px", marginBottom: 6 }}>
            {confirmDelete === label ? (
              <div>
                <div style={{ fontSize: 12, color: "#ff7b7b", marginBottom: 8 }}>
                  Deleting "{label}" permanently removes this archive. It cannot be recovered.
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={confirmChecked} onChange={e => setConfirmChecked(e.target.checked)} />
                  I've exported a copy, or don't need one.
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" disabled={!confirmChecked} onClick={() => confirmDeleteLabel(label)}
                    style={{ background: "rgba(255,107,107,0.15)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: confirmChecked ? "pointer" : "default", opacity: confirmChecked ? 1 : 0.5 }}>
                    Delete permanently
                  </button>
                  <button type="button" onClick={() => { setConfirmDelete(null); setConfirmChecked(false); }}
                    style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span onClick={() => openArchive(label)} style={{ flex: 1, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>{label}</span>
                <button type="button" onClick={() => setConfirmDelete(label)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>🗑</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
