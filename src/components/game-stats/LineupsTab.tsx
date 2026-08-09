// src/components/game-stats/LineupsTab.tsx
// The coach-only Lineups section. Everything here is season-scoped and
// derived from shifts; per-game shift ENTRY lives inside the game itself,
// under Games, because it's about one game rather than the season.
//
// Rankings and Rotation are deliberately visible but empty. They're real
// planned surfaces (Phase 3 and 4), and a placeholder that says what's
// coming and what it needs is more useful than a tab that silently appears
// one day -- it also makes the shape of the section obvious now.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { listSeasons } from "../../lib/gameStats";
import { getRosters } from "../../lib/practicePlanner";
import LineupReport from "./LineupReport";

type Sub = "reports" | "rankings" | "rotation";

export default function LineupsTab() {
  const [sub, setSub] = useState<Sub>("reports");
  const [rosters, setRosters] = useState<{ id: string; name: string }[]>([]);
  const [rosterId, setRosterId] = useState<string>("");
  const [seasons, setSeasons] = useState<string[]>([]);
  const [season, setSeason] = useState<string>("");
  const [gamesWithShifts, setGamesWithShifts] = useState<{ id: string; label: string }[]>([]);
  const [gameId, setGameId] = useState<string>("");

  useEffect(() => {
    getRosters().then((rs) => {
      const list = rs.map((r) => ({ id: r.id, name: r.name }));
      setRosters(list);
      setRosterId((cur) => cur || (list[0]?.id ?? ""));
    });
    listSeasons().then((ss) => {
      setSeasons(ss);
      setSeason((cur) => cur || ss[0] || "");
    });
  }, []);

  // Only games that actually have shifts are worth offering in the picker --
  // choosing one with none would render an empty report with no explanation.
  useEffect(() => {
    (async () => {
      const { data: shiftRows } = await supabase.from("shifts").select("game_id");
      const ids = [...new Set(((shiftRows ?? []) as any[]).map((r) => r.game_id as string))];
      if (!ids.length) { setGamesWithShifts([]); return; }
      let q = supabase.from("games").select("id, opponent, game_date, season, roster_id").in("id", ids).order("game_date", { ascending: false });
      const { data: games } = await q;
      setGamesWithShifts(
        ((games ?? []) as any[])
          .filter((g) => (!rosterId || g.roster_id === rosterId || g.roster_id == null) && (!season || g.season === season))
          .map((g) => ({ id: g.id, label: `${g.opponent} · ${g.game_date}` })),
      );
    })();
  }, [rosterId, season]);

  const field: React.CSSProperties = {
    padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
    background: "var(--surface2)", color: "var(--text)", fontSize: 13,
  };

  return (
    <div>
      <div className="role-tabs" style={{ marginBottom: 12, width: "100%", maxWidth: 1400 }}>
        <button className={`role-tab ${sub === "reports" ? "active" : ""}`} onClick={() => setSub("reports")}>Reports</button>
        <button className={`role-tab ${sub === "rankings" ? "active" : ""}`} onClick={() => setSub("rankings")}>Rankings</button>
        <button className={`role-tab ${sub === "rotation" ? "active" : ""}`} onClick={() => setSub("rotation")}>Rotation</button>
      </div>

      {sub === "reports" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            {rosters.length > 1 && (
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--muted)" }}>
                Roster
                <select value={rosterId} onChange={(e) => { setRosterId(e.target.value); setGameId(""); }} style={field}>
                  {rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--muted)" }}>
              Season
              <select value={season} onChange={(e) => { setSeason(e.target.value); setGameId(""); }} style={field}>
                {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--muted)" }}>
              Scope
              <select value={gameId} onChange={(e) => setGameId(e.target.value)} style={field}>
                <option value="">Whole season</option>
                {gamesWithShifts.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </label>
          </div>

          <LineupReport gameId={gameId || null} rosterId={rosterId || null} season={season || undefined} />
        </>
      )}

      {sub === "rankings" && (
        <Placeholder
          title="Rankings"
          blurb="Top 3, bottom 3, and a needs-more-data list for each of individual, 2-man, 3-man and 5-man groups — ranked on net rating adjusted for how little you've seen each one, with a goal scorecard alongside."
          needs={[
            "On/off differentials, so an individual's number isn't just a reflection of who he plays with",
            "Sample-size shrinkage, so a five that went +47 over 22 possessions doesn't top the board",
            "Roughly 8–10 games of shifts before the numbers say much at any level below 2-man",
          ]}
        />
      )}

      {sub === "rotation" && (
        <Placeholder
          title="Rotation"
          blurb="A heatmap of what your rotation actually looks like (all games, or close games only), findings drawn from the season, and a block-based planner for building the rotation you want."
          needs={[
            "Estimated minutes per shift, calibrated per period",
            "Score margin derived from the possession log, so blowout minutes can be filtered out",
            "Enough games that an “average rotation” means something — roughly 10",
          ]}
        />
      )}
    </div>
  );
}

function Placeholder({ title, blurb, needs }: { title: string; blurb: string; needs: string[] }) {
  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ fontSize: 14, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>{blurb}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Not built yet. It needs:</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--muted)", lineHeight: 1.8 }}>
        {needs.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
    </div>
  );
}
