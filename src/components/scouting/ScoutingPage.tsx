// src/components/scouting/ScoutingPage.tsx
// The coaches' Scouting page: two tabs.
//   Calendar      -- other teams' games and who's scouting them (live or film)
//   Scout Sheets  -- the opponent reports, exactly as before
// The Calendar's "Open scout sheet" jumps to the Scout Sheets tab on that
// game's sheet. Players don't come here; they keep their own Scout page
// (sheets only).

import { useEffect, useState } from "react";
import ScoutingCalendar from "./ScoutingCalendar";
import ScoutSheetsHub from "./ScoutSheetsHub";

type Tab = "calendar" | "sheets";
const KEY = "ww.scoutingTab";

interface Props {
  /** Set when the Schedule opens a game's scout sheet. */
  initialGameId?: string | null;
}

export default function ScoutingPage({ initialGameId }: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    if (initialGameId) return "sheets";
    try { return (localStorage.getItem(KEY) as Tab) === "sheets" ? "sheets" : "calendar"; } catch { return "calendar"; }
  });
  // Which game's sheet to open on the Scout Sheets tab (from the Schedule or the Calendar).
  const [sheetGameId, setSheetGameId] = useState<string | null>(initialGameId ?? null);

  useEffect(() => { if (initialGameId) { setSheetGameId(initialGameId); setTab("sheets"); } }, [initialGameId]);
  useEffect(() => { try { localStorage.setItem(KEY, tab); } catch { /* fine */ } }, [tab]);

  const label: Record<Tab, string> = { calendar: "Calendar", sheets: "Scout Sheets" };
  return (
    <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: "var(--title)", letterSpacing: 1, marginBottom: 10 }}>Scouting</div>
      <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
        {(["calendar", "sheets"] as Tab[]).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t}
            onClick={() => { setTab(t); if (t === "sheets") setSheetGameId(null); }}
            style={{
              fontSize: 13, fontWeight: 600, padding: "7px 16px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
              background: tab === t ? "var(--royal)" : "var(--surface2)", color: tab === t ? "#fff" : "var(--text)",
              border: tab === t ? "1px solid var(--royal)" : "1px solid var(--border)",
            }}>
            {label[t]}
          </button>
        ))}
      </div>
      {tab === "calendar" && <ScoutingCalendar onOpenSheet={id => { setSheetGameId(id); setTab("sheets"); }} />}
      {tab === "sheets" && <ScoutSheetsHub canManage={true} initialGameId={sheetGameId} key={sheetGameId ?? "list"} />}
    </div>
  );
}
