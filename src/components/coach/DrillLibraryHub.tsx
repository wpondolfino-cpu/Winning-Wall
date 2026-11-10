// src/components/coach/DrillLibraryHub.tsx
// The coaches' one Drill Library: team drills (what practices are built
// from), player drills (the scored offseason ones) and the tools for
// cleaning up both libraries' categories and tags. Each tab is the page
// it replaced, unchanged. Players don't come here -- they keep their own
// Player Drills page.
//
// A program with in-season or offseason switched off loses that tab; the
// page itself only disappears when both are off (see lib/features).

import { useEffect, useState } from "react";
import PracticeDrillLibrary from "./PracticeDrillLibrary";
import DrillLibrary from "../DrillLibrary";
import ManageDrillTaxonomy from "./ManageDrillTaxonomy";

export type DrillLibraryTab = "team" | "player" | "manage";

interface Props {
  initialTab?: DrillLibraryTab;
  showTeam: boolean;
  showPlayer: boolean;
  onPlayerDrillsChanged?: () => void;
  onChallenge?: () => void;
}

const KEY = "ww.drillLibraryTab";

export default function DrillLibraryHub({ initialTab, showTeam, showPlayer, onPlayerDrillsChanged, onChallenge }: Props) {
  const available: DrillLibraryTab[] = [...(showTeam ? ["team" as const] : []), ...(showPlayer ? ["player" as const] : []), "manage"];
  const remembered = (() => { try { return localStorage.getItem(KEY) as DrillLibraryTab | null; } catch { return null; } })();
  const first = [initialTab, remembered, available[0]].find(t => t && available.includes(t)) as DrillLibraryTab;
  const [tab, setTab] = useState<DrillLibraryTab>(first);
  useEffect(() => { if (initialTab && available.includes(initialTab)) setTab(initialTab); }, [initialTab]);
  useEffect(() => { try { localStorage.setItem(KEY, tab); } catch { /* fine */ } }, [tab]);

  const label: Record<DrillLibraryTab, string> = { team: "Team drills", player: "Player drills", manage: "Categories & tags" };
  return (
    <div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: "var(--title)", letterSpacing: 1, marginBottom: 10 }}>Drill Library</div>
      <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
        {available.map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            style={{
              fontSize: 13, fontWeight: 600, padding: "7px 16px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
              background: tab === t ? "var(--royal)" : "var(--surface2)", color: tab === t ? "#fff" : "var(--text)",
              border: tab === t ? "1px solid var(--royal)" : "1px solid var(--border)",
            }}>
            {label[t]}
          </button>
        ))}
      </div>
      {tab === "team" && showTeam && <PracticeDrillLibrary canManage={true} />}
      {tab === "player" && showPlayer && <DrillLibrary canManage={true} onChanged={onPlayerDrillsChanged} onChallenge={onChallenge} />}
      {tab === "manage" && <ManageDrillTaxonomy showTeam={showTeam} showPlayer={showPlayer} />}
    </div>
  );
}
