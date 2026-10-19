// src/lib/leaderboardExport.ts
// Print / Export CSV for the current Offseason and In-season leaderboards.
// Same numbers and columns as History's export, because both come from
// the standings the season archive uses (seasonReset.ts).

import { supabase } from "./supabase";
import { offseasonStandings, inSeasonStandings } from "./seasonReset";

export type BoardKind = "offseason" | "inseason";
export interface BoardTable { kind: BoardKind; title: string; columns: string[]; rows: (string | number | null)[][]; }

async function names(): Promise<Record<string, string>> {
  const { data } = await supabase.from("profiles").select("id, name");
  const map: Record<string, string> = {};
  (data ?? []).forEach((p: any) => { map[p.id] = p.name; });
  return map;
}

const byRank = (a: { overall_rank: number | null }, b: { overall_rank: number | null }) =>
  (a.overall_rank ?? Infinity) - (b.overall_rank ?? Infinity);

export async function loadBoard(kind: BoardKind): Promise<BoardTable> {
  const n = await names();
  if (kind === "offseason") {
    const rows = (await offseasonStandings()).sort(byRank);
    return {
      kind, title: "Offseason leaderboard",
      columns: ["Name", "Overall Rank", "Grade", "Total Points", "Drill Wins", "H2H Wins"],
      rows: rows.map(r => [n[r.player_id] ?? "Unknown", r.overall_rank, r.grade_category, r.total_points, r.drill_wins, r.h2h_wins]),
    };
  }
  const rows = (await inSeasonStandings()).sort(byRank);
  return {
    kind, title: "In-season leaderboard",
    columns: ["Name", "Overall Rank", "Roster", "Total Wins"],
    rows: rows.map(r => [n[r.player_id] ?? "Unknown", r.overall_rank, r.roster_name, r.total_wins]),
  };
}

function csvCell(v: string | number | null): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export function downloadBoardCsv(t: BoardTable): void {
  const csv = [t.columns, ...t.rows].map(r => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${t.kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
