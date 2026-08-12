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
import RankingsPanel from "./RankingsPanel";
import RotationPanel from "./RotationPanel";

type Sub = "reports" | "rankings" | "rotation";
interface GameLite {
  id: string;
  opponent: string;
  game_date: string;
  won: boolean | null;
  hasShifts: boolean;
}

export default function LineupsTab({ userId }: { userId: string }) {
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
      {/* Scope sits above the sub-tabs because it applies to both Reports and
          Rankings. Ranking a three-game filter isn't a worry -- the sample
          gates already refuse to rank that little. */}
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

      <div className="role-tabs" style={{ marginBottom: 12, width: "100%", maxWidth: 1400 }}>
        <button className={`role-tab ${sub === "reports" ? "active" : ""}`} onClick={() => setSub("reports")}>Reports</button>
        <button className={`role-tab ${sub === "rankings" ? "active" : ""}`} onClick={() => setSub("rankings")}>Rankings</button>
        <button className={`role-tab ${sub === "rotation" ? "active" : ""}`} onClick={() => setSub("rotation")}>Rotation</button>
      </div>

      {sub === "reports" && (
        <>

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

      {sub === "rankings" && <RankingsPanel gameIds={selectedIds} />}

      {sub === "rotation" && <RotationPanel gameIds={selectedIds} userId={userId} rosterId={rosterId || null} />}
    </div>
  );
}
