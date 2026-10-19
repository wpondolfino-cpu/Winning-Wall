// src/lib/exportData.ts
// "Download program data" (migration 195): one Excel file with a tab per
// area. Platform admin only (the database checks); test accounts left out.

import { supabase } from "./supabase";
import { buildXlsx, downloadBlob, Sheet } from "./xlsx";

/** Downloads a program's data. No id = the program you're in now. */
export async function downloadProgramData(programId?: string | null): Promise<{ program: string; tabs: number; rows: number }> {
  const { data, error } = await supabase.rpc("program_export", { p_program: programId ?? null });
  if (error) throw error;
  const res = data as { program: string; org: string; sheets: Sheet[] };
  const blob = buildXlsx(res.sheets);
  const day = new Date().toISOString().slice(0, 10);
  const safe = `${res.org} ${res.program}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  downloadBlob(blob, `${safe} data ${day}.xlsx`);
  return {
    program: res.program,
    tabs: res.sheets.length,
    rows: res.sheets.reduce((n, s) => n + (s.name === "About" ? 0 : s.rows.length), 0),
  };
}
