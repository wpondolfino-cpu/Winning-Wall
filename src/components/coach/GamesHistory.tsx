// src/components/coach/GamesHistory.tsx
// Every game gets a permanent row here. Coaches see draft and published
// games; the "Push to team" action flips status to 'published', which is
// the only thing that makes a game's report visible to players (enforced
// by RLS on games/possessions, not by this component).

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Game } from "../../lib/gameStats";

interface Props {
  userId: string;
  onOpenGame: (gameId: string) => void;
}

export default function GamesHistory({ userId, onOpenGame }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [opponent, setOpponent] = useState("");
  const [gameDate, setGameDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("games").select("*").order("game_date", { ascending: false });
    setGames((data as Game[]) ?? []);
    setLoading(false);
  }

  async function createGame() {
    if (!opponent.trim()) return;
    const season = seasonForDate(gameDate);
    const { data, error } = await supabase
      .from("games")
      .insert({ opponent: opponent.trim(), game_date: gameDate, season, created_by: userId })
      .select()
      .single();
    if (!error && data) {
      setGames((g) => [data as Game, ...g]);
      setCreating(false);
      setOpponent("");
      onOpenGame((data as Game).id);
    }
  }

  async function publish(gameId: string) {
    const { error } = await supabase.from("games").update({ status: "published" }).eq("id", gameId);
    if (!error) setGames((g) => g.map((game) => (game.id === gameId ? { ...game, status: "published" } : game)));
  }

  if (loading) return <div className="card">Loading games…</div>;

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Games</span>
        <button className="btn-primary" style={{ padding: "6px 14px", width: "auto" }} onClick={() => setCreating(true)}>
          New game
        </button>
      </div>

      {creating && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            autoFocus
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="Opponent"
            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
          />
          <input
            type="date"
            value={gameDate}
            onChange={(e) => setGameDate(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
          />
          <button className="btn-primary" style={{ width: "auto", padding: "8px 14px" }} onClick={createGame}>Start</button>
        </div>
      )}

      {games.map((g) => (
        <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
          <div style={{ cursor: "pointer" }} onClick={() => onOpenGame(g.id)}>
            <span style={{ fontSize: 14 }}>vs {g.opponent}</span>{" "}
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              · {g.game_date}
              {g.final_score_us != null && g.final_score_them != null
                ? ` · ${g.final_score_us > g.final_score_them ? "W" : "L"} ${g.final_score_us}-${g.final_score_them}`
                : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 12,
                padding: "2px 10px",
                borderRadius: 8,
                background: g.status === "published" ? "#1f7a4d22" : "var(--surface2)",
                color: g.status === "published" ? "#1f7a4d" : "var(--muted)",
              }}
            >
              {g.status === "published" ? "Published" : "Draft"}
            </span>
            {g.status === "draft" && (
              <button style={{ padding: "6px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer" }} onClick={() => publish(g.id)}>
                Push to team
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function seasonForDate(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  // Basketball season spans Nov-Mar-ish; games from Aug-Dec count as
  // "start year - start year+1", games Jan-Jul count as the prior split.
  const month = d.getMonth() + 1;
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}
