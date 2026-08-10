// src/components/game-stats/LineupsTab.tsx
// The coach-only Lineups section.
//
// This tab owns WHICH GAMES a report covers; LineupReport owns how to read
// them. That split matters because the two were tangled before: the game
// type filter lived inside the report while the game picker lived here, so
// picking "Practices" didn't change which games the picker offered.
//
// Scope is deliberately two steps rather than one long list. Type first
// (games, scrimmages, practices, summer), then a scope within it — all of
// them, the last few, wins only, losses only, or one specific game. A single
// flat dropdown would mix "all practices" and "Franklin, Jan 14" as if they
// were the same kind of choice.
//
// Rankings and Rotation are visible but empty on purpose. They're real
// planned surfaces, and a placeholder saying what's coming and what it needs
// is more use than a tab that silently appears one day.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { listSeasons, gameTypesForGroup, GAME_GROUPS, isGameFinal, type GameGroup } from "../../lib/gameStats";
import { getRosters } from "../../lib/practicePlanner";
import LineupReport from "./LineupReport";
import GameScopePicker, { type ScopeGame } from "./GameScopePicker";

type Sub = "reports" | "rankings" | "rotation";
interface GameLite {
  id: string;
  opponent: string;
  game_date: string;
  won: boolean | null;
  hasShifts: boolean;
}

export default function LineupsTab() {
  const [sub, setSub] = useState<Sub>("reports");
  const [rosters, setRosters] = useState<{ id: string; name: string }[]>([]);
  const [rosterId, setRosterId] = useState<string>("");
  const [seasons, setSeasons] = useState<string[]>([]);
  const [season, setSeason] = useState<string>("");
  const [gameGroup, setGameGroup] = useState<GameGroup>("games");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [games, setGames] = useState<GameLite[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Only games with shifts entered are worth offering — picking one without
  // them would render an empty report and no explanation of why.
  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase
        .from("games")
        .select("id, opponent, game_date, final_score_us, final_score_them")
        .in("game_type", gameTypesForGroup(gameGroup))
        .order("game_date", { ascending: false });
      if (rosterId) q = q.eq("roster_id", rosterId);
      if (season) q = q.eq("season", season);
      const { data } = await q;

      const rows = (data ?? []) as any[];
      const { data: shiftRows } = rows.length
        ? await supabase.from("shifts").select("game_id").in("game_id", rows.map((g) => g.id))
        : { data: [] as any[] };
      const withShifts = new Set(((shiftRows ?? []) as any[]).map((r) => r.game_id as string));

      setGames(rows.map((g) => ({
        id: g.id,
        opponent: g.opponent,
        game_date: g.game_date,
        won: isGameFinal(g) ? g.final_score_us > g.final_score_them : null,
        hasShifts: withShifts.has(g.id),
      })));
      setLoading(false);
    })();
  }, [rosterId, season, gameGroup]);

  // Only games with shifts are pickable -- one without them would render an
  // empty report and no explanation.
  const pickable = useMemo<ScopeGame[]>(
    () => games.filter((g) => g.hasShifts).map((g) => ({ id: g.id, opponent: g.opponent, game_date: g.game_date, won: g.won })),
    [games],
  );

  // Everything selected whenever the pool changes underneath, so you can't
  // be left pointing at games that are no longer on offer.
  useEffect(() => { setSelectedIds(pickable.map((g) => g.id)); }, [pickable]);

  const groupLabel = GAME_GROUPS.find((g) => g.value === gameGroup)?.label ?? "Games";
  const tracked = games.filter((g) => g.hasShifts);

  const field: React.CSSProperties = {
    padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
    background: "var(--surface2)", color: "var(--text)", fontSize: 13,
  };
  const wrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--muted)" };

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
              <label style={wrap}>
                Roster
                <select value={rosterId} onChange={(e) => setRosterId(e.target.value)} style={field}>
                  {rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            )}

            <label style={wrap}>
              Season
              <select value={season} onChange={(e) => setSeason(e.target.value)} style={field}>
                {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <label style={wrap}>
              Type
              <select value={gameGroup} onChange={(e) => setGameGroup(e.target.value as GameGroup)} style={field}>
                {GAME_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </label>

            <label style={wrap}>
              {groupLabel}
              <GameScopePicker
                games={pickable}
                selected={selectedIds}
                onChange={setSelectedIds}
                noun={groupLabel.toLowerCase()}
              />
            </label>
          </div>

          {!loading && !tracked.length ? (
            <div className="card">
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                No {groupLabel.toLowerCase()} have shifts entered for this season yet. Open a game from the Games tab and use its shifts chip.
              </div>
            </div>
          ) : (
            <LineupReport gameIds={selectedIds} />
          )}
        </>
      )}

      {sub === "rankings" && (
        <Placeholder
          title="Rankings"
          blurb="Top 3, bottom 3, and a needs-more-data list for each of individual, 2-man, 3-man and 5-man groups — ranked on net rating adjusted for how little you've seen each one, with a goal scorecard alongside."
          needs={[
            "Roughly 8–10 games of shifts before the numbers say much at any level below 2-man",
            "A decision on whether ranking is by adjusted net, goals hit, or both",
          ]}
        />
      )}

      {sub === "rotation" && (
        <Placeholder
          title="Rotation"
          blurb="A heatmap of what your rotation actually looks like (all games, or close games only), findings drawn from the season, and a block-based planner for building the rotation you want."
          needs={[
            "Foul trouble across enough games to show where plans break",
            "Enough games that an \u201Caverage rotation\u201D means something — roughly 10",
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
