// src/components/scouting/ScoutSheetsHub.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import {
  Opponent, getOpponents, createOpponent, uploadOpponentLogo,
  getOpponentLastGames, getScoutSheetsForOpponent,
  createScoutSheet, duplicateScoutSheet,
} from "../../lib/scoutSheets";
import ScoutSheetBuilder from "./ScoutSheetBuilder";
import { inputStyle } from "../../lib/inputStyle";

interface Props {
  canManage: boolean; // coach/admin = true, player = false (read-only, published only)
}

export default function ScoutSheetsHub({ canManage }: Props) {
  const [opponents, setOpponents] = useState<Opponent[]>([]);
  const [newOpponentName, setNewOpponentName] = useState("");
  const [activeOpponent, setActiveOpponent] = useState<Opponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastGames, setLastGames] = useState<any[]>([]);
  const [allSheets, setAllSheets] = useState<any[]>([]);
  const [showAllSheets, setShowAllSheets] = useState(false);
  const [openSheetId, setOpenSheetId] = useState<string | null>(null);
  const [newGameDate, setNewGameDate] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadOpponents = useCallback(async () => {
    setOpponents(await getOpponents());
  }, []);

  useEffect(() => { loadOpponents().catch(console.error); }, [loadOpponents]);

  async function openOpponent(o: Opponent) {
    setActiveOpponent(o);
    setShowAllSheets(false);
    const [games, sheets] = await Promise.all([getOpponentLastGames(o.id, 5), getScoutSheetsForOpponent(o.id)]);
    setLastGames(games);
    setAllSheets(sheets);
  }

  async function addOpponent() {
    if (!newOpponentName.trim()) return;
    setError(null);
    try {
      const o = await createOpponent(newOpponentName.trim());
      setNewOpponentName("");
      loadOpponents();
      openOpponent(o);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't add opponent — try again.");
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!activeOpponent || !e.target.files?.[0]) return;
    try {
      const url = await uploadOpponentLogo(activeOpponent.id, e.target.files[0]);
      setActiveOpponent({ ...activeOpponent, logo_url: url });
      loadOpponents();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't upload logo — try again.");
    }
  }

  // Creates a bare-bones game record tied to this opponent, then the
  // scout sheet on top of it. Keeps this feature usable without
  // requiring a full trip through the Game Stats game-creation flow.
  async function startNewScoutSheet(duplicateFromSheetId?: string) {
    if (!activeOpponent || !newGameDate) return;
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in."); return; }
    const { data: game, error: gameErr } = await supabase.from("games").insert({
      opponent: activeOpponent.name,
      opponent_id: activeOpponent.id,
      game_date: newGameDate,
      season: new Date(newGameDate).getFullYear().toString(),
      home_away: "home",
      status: "draft",
      created_by: user.id,
    }).select().single();
    if (gameErr) { setError(gameErr.message); return; }

    try {
      const sheet = duplicateFromSheetId
        ? await duplicateScoutSheet(duplicateFromSheetId, game.id)
        : await createScoutSheet(game.id, activeOpponent.id);
      setNewGameDate("");
      openOpponent(activeOpponent);
      setOpenSheetId(sheet.id);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't create the scout sheet — try again.");
    }
  }

  if (openSheetId) {
    return <ScoutSheetBuilder scoutSheetId={openSheetId} canManage={canManage} onClose={() => { setOpenSheetId(null); if (activeOpponent) openOpponent(activeOpponent); }} />;
  }

  if (activeOpponent) {
    const mostRecentSheet = allSheets[0];
    return (
      <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
        <button type="button" onClick={() => setActiveOpponent(null)} style={{ marginBottom: 16, background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>← All opponents</button>
        {error && <div className="error-msg">{error}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div onClick={() => canManage && fileRef.current?.click()} style={{ width: 56, height: 56, borderRadius: 12, background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: canManage ? "pointer" : "default", overflow: "hidden" }}>
            {activeOpponent.logo_url ? <img src={activeOpponent.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "var(--muted)" }}>Logo</span>}
          </div>
          {canManage && <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: "none" }} />}
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{activeOpponent.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{allSheets.length} scout sheet{allSheets.length === 1 ? "" : "s"} on file</div>
          </div>
        </div>

        {canManage && (
          <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
            <input type="date" value={newGameDate} onChange={e => setNewGameDate(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <button type="button" disabled={!newGameDate} onClick={() => startNewScoutSheet()} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "0 14px", fontWeight: 600, cursor: "pointer" }}>New sheet</button>
            {mostRecentSheet && (
              <button type="button" disabled={!newGameDate} onClick={() => startNewScoutSheet(mostRecentSheet.id)} style={{ background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 14px", fontWeight: 600, cursor: "pointer" }}>Duplicate last</button>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Last 5 games</div>
        {lastGames.map(g => (
          <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {g.final_score_us != null && g.final_score_them != null
                  ? `${g.final_score_us > g.final_score_them ? "W" : "L"} ${g.final_score_us}–${g.final_score_them}`
                  : "Not final"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(g.game_date).toLocaleDateString()}</div>
            </div>
            {g.scout_sheet
              ? <button type="button" onClick={() => setOpenSheetId(g.scout_sheet.id)} style={{ background: "none", border: "none", color: "var(--royal-light)", cursor: "pointer", fontSize: 12 }}>View scout sheet →</button>
              : <span style={{ fontSize: 12, color: "var(--muted)" }}>No scout sheet</span>}
          </div>
        ))}

        {allSheets.length > 5 && !showAllSheets && (
          <button type="button" onClick={() => setShowAllSheets(true)} style={{ marginTop: 10, background: "none", border: "none", color: "var(--royal-light)", cursor: "pointer", fontSize: 12 }}>View all scout sheets ({allSheets.length}) →</button>
        )}
        {showAllSheets && (
          <div style={{ marginTop: 10 }}>
            {allSheets.map(s => (
              <div key={s.id} onClick={() => setOpenSheetId(s.id)} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border)", cursor: "pointer", fontSize: 12 }}>
                <span>{s.games?.game_date ? new Date(s.games.game_date).toLocaleDateString() : "—"}</span>
                <span style={{ color: "var(--muted)" }}>{s.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
      {error && <div className="error-msg">{error}</div>}
      {canManage && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input value={newOpponentName} onChange={e => setNewOpponentName(e.target.value)} placeholder="New opponent name"
            onKeyDown={e => { if (e.key === "Enter") addOpponent(); }} style={{ ...inputStyle, flex: 1 }} />
          <button type="button" onClick={addOpponent} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "0 16px", fontWeight: 600, cursor: "pointer" }}>Add</button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {opponents.map(o => (
          <div key={o.id} onClick={() => openOpponent(o)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface2)", borderRadius: 10, cursor: "pointer" }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--surface1)", overflow: "hidden", flexShrink: 0 }}>
              {o.logo_url && <img src={o.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{o.name}</span>
          </div>
        ))}
        {opponents.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>No opponents yet — add one above.</div>}
      </div>
    </div>
  );
}
