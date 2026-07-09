// src/components/HallOfFame.tsx
import { useState, useEffect } from "react";
import { supabase, getRecords, getBestScoreRecords, currentPeriodStart, currentPeriodEnd } from "../lib/supabase";

const SHORT: Record<string, string> = {
  "Underclassman (9th-10th)": "Underclassman",
  "Upperclassman (11th-12th)": "Upperclassman",
};

const RECORD_META: Record<string, { label: string; icon: string; desc: string }> = {
  most_points_alltime:   { label: "Most Points All-Time",          icon: "💯", desc: "Highest total points ever accumulated across all seasons" },
  most_workouts_alltime: { label: "Most Workouts All-Time",         icon: "💪", desc: "Most total drill submissions ever recorded" },
  most_challenges_won:   { label: "Most Challenges Won",            icon: "⚔️", desc: "Most head-to-head challenge victories all-time" },
  best_win_rate:         { label: "Best Challenge Win Rate",        icon: "🎯", desc: "Highest win % with a minimum of 10 challenges completed" },
  longest_streak:        { label: "Longest Streak Ever",            icon: "🔥", desc: "Most consecutive days with at least one workout logged" },
  most_points_period:    { label: "Most Points in a Single Period", icon: "📅", desc: "Highest points earned in one biweekly competition period" },
  most_periods_won:      { label: "Most Biweekly Periods Won",      icon: "👑", desc: "Most total biweekly championship periods won all-time" },
};

type HofTab = "champions" | "records";

interface Props {
  canDelete?: boolean;
  onViewWorkout?: (workoutId: string) => void;
}

export default function HallOfFame({ canDelete = false, onViewWorkout }: Props) {
  const [tab, setTab]               = useState<HofTab>("champions");
  const [champions, setChampions]   = useState<any[]>([]);
  const [allRecords, setAllRecords] = useState<any[]>([]);
  const [drillRecords, setDrillRecords] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast]           = useState("");

  const periodStart = currentPeriodStart();
  const periodEnd   = currentPeriodEnd();

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [{ data: champs }, all, drills] = await Promise.all([
      supabase.from("biweekly_champions").select("*").order("crowned_at", { ascending: false }),
      getRecords(),
      getBestScoreRecords(),
    ]);
    setChampions(champs ?? []);
    setAllRecords(all.filter((r: any) => r.record_type !== "best_score"));
    setDrillRecords(drills);
    setLoading(false);
  }

  async function deleteRecord(id: string, label: string) {
    if (!window.confirm(`Delete the "${label}" record? This cannot be undone.\n\nIt will reappear automatically if someone sets a new score for this drill.`)) return;
    setDeletingId(id);
    try {
      const { error } = await supabase.from("records").delete().eq("id", id);
      if (error) throw error;
      await loadAll();
      showToast("✅ Record deleted.");
    } catch (e: any) {
      showToast("Error: " + e.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteChampion(id: string, name: string) {
    if (!window.confirm(`Remove ${name}'s champion entry? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const { error } = await supabase.from("biweekly_champions").delete().eq("id", id);
      if (error) throw error;
      await loadAll();
      showToast("✅ Champion entry deleted.");
    } catch (e: any) {
      showToast("Error: " + e.message);
    } finally {
      setDeletingId(null);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const latestTime = champions.length > 0 ? new Date(champions[0].crowned_at).getTime() : 0;
  const reigningIds = new Set(
    champions
      .filter(c => Math.abs(new Date(c.crowned_at).getTime() - latestTime) < 60000)
      .map(c => c.id)
  );

  return (
    <div className="panel active">

      {/* Header */}
      <div className="section-title">👑 Hall of Fame</div>
      <div className="section-sub">
        Current period: {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
      </div>

      {/* Admin mode indicator */}
      {canDelete && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.25)", borderRadius: 10, marginBottom: 16, fontSize: 12, color: "var(--gold)" }}>
          👑 Admin mode — delete buttons visible. Players do not see these.
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 12, padding: 5, marginBottom: 22, border: "1px solid var(--border)" }}>
        <button onClick={() => setTab("champions")} style={{
          flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer",
          fontFamily: "inherit", fontSize: 13, fontWeight: 600,
          background: tab === "champions" ? "var(--royal)" : "transparent",
          color: tab === "champions" ? "#fff" : "var(--muted)", transition: "all .2s",
        }}>👑 Biweekly Champions</button>
        <button onClick={() => setTab("records")} style={{
          flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer",
          fontFamily: "inherit", fontSize: 13, fontWeight: 600,
          background: tab === "records" ? "var(--royal)" : "transparent",
          color: tab === "records" ? "#fff" : "var(--muted)", transition: "all .2s",
        }}>🏅 Records</button>
      </div>

      {loading && (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0" }}>Loading…</div>
      )}

      {/* ── BIWEEKLY CHAMPIONS ── */}
      {!loading && tab === "champions" && (
        <div>
          {champions.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: "60px 0" }}>
              No champions yet — crown the first winner to start the Hall of Fame! 👑
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {champions.map(c => {
                const isReigning = reigningIds.has(c.id);
                const initials = c.player_name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0,2);
                return (
                  <div key={c.id} style={{
                    background: isReigning ? "linear-gradient(135deg, rgba(240,192,64,0.12), rgba(26,63,168,0.15))" : "var(--surface2)",
                    border: `1px solid ${isReigning ? "rgba(240,192,64,0.4)" : "var(--border)"}`,
                    borderRadius: 14, padding: "18px 20px",
                    display: "flex", alignItems: "center", gap: 16,
                  }}>
                    {/* Avatar */}
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <div style={{
                        width: 64, height: 64, borderRadius: "50%", overflow: "hidden",
                        border: `3px solid ${isReigning ? "var(--gold)" : "var(--border)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(26,63,168,0.3)",
                      }}>
                        {c.avatar_url
                          ? <img src={c.avatar_url} alt={c.player_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>{initials}</span>
                        }
                      </div>
                      {isReigning && <div style={{ position: "absolute", bottom: -4, right: -4, fontSize: 18 }}>👑</div>}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {!isReigning && <span>👑</span>}
                        <div style={{ fontWeight: 700, fontSize: 16, color: isReigning ? "var(--gold)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.player_name}
                        </div>
                        {isReigning && (
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "rgba(240,192,64,0.2)", color: "var(--gold)" }}>
                            REIGNING
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                        {c.grade_category && <span>{SHORT[c.grade_category] ?? c.grade_category} · </span>}
                        {c.period_number ? `Period ${c.period_number} · ` : ""}
                        {new Date(c.period_start).toLocaleDateString()} – {new Date(c.period_end).toLocaleDateString()}
                      </div>
                    </div>

                    {/* Points + admin delete */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, color: isReigning ? "var(--gold)" : "#93b4ff", lineHeight: 1 }}>{c.points}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>pts</div>
                      </div>
                      {canDelete && (
                        <button
                          onClick={() => deleteChampion(c.id, c.player_name)}
                          disabled={deletingId === c.id}
                          style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", opacity: deletingId === c.id ? 0.6 : 1 }}
                        >
                          {deletingId === c.id ? "…" : "🗑 Delete"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── RECORDS ── */}
      {!loading && tab === "records" && (
        <div>
          {/* All-time records */}
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1, marginBottom: 14 }}>
            🏅 All-Time Records
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
            {Object.entries(RECORD_META).map(([type, meta]) => {
              const rec = allRecords.find((r: any) => r.record_type === type);
              const initials = rec ? rec.player_name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase() : "";
              return (
                <div key={type} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ fontSize: 28, flexShrink: 0 }}>{meta.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--gold)" }}>{meta.label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>{meta.desc}</div>
                    {rec && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{rec.season}</div>}
                  </div>
                  {rec ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "#93b4ff", lineHeight: 1 }}>{rec.display_value}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{rec.player_name}</div>
                      </div>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", border: "2px solid var(--gold)", background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {rec.avatar_url
                          ? <img src={rec.avatar_url} alt={rec.player_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)" }}>{initials}</span>
                        }
                      </div>
                      {canDelete && (
                        <button
                          onClick={() => deleteRecord(rec.id, meta.label)}
                          disabled={deletingId === rec.id}
                          style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", flexShrink: 0, opacity: deletingId === rec.id ? 0.6 : 1 }}
                        >
                          {deletingId === rec.id ? "…" : "🗑"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>Not set yet</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Be the first!</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Best score per drill */}
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1, marginBottom: 14 }}>
            🎯 Best Score Per Drill
          </div>
          {drillRecords.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)", padding: "20px 0" }}>No drill records yet — be the first to set one!</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {drillRecords.map((rec: any) => {
                const initials = rec.player_name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase();
                return (
                  <div key={rec.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          onClick={() => rec.workout_id && onViewWorkout?.(rec.workout_id)}
                          style={{
                            fontWeight: 700, fontSize: 13, color: "var(--text)",
                            cursor: rec.workout_id && onViewWorkout ? "pointer" : "default",
                            textDecoration: rec.workout_id && onViewWorkout ? "underline" : "none",
                            textDecorationColor: "rgba(176,184,200,0.35)",
                          }}
                        >
                          {rec.workout_title}
                        </div>
                        {rec.workout_desc && (
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>{rec.workout_desc}</div>
                        )}
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{rec.season} · {new Date(rec.achieved_at).toLocaleDateString()}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--gold)", lineHeight: 1 }}>{rec.display_value}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{rec.player_name}</div>
                        </div>
                        <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", border: "2px solid var(--gold)", background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {rec.avatar_url
                            ? <img src={rec.avatar_url} alt={rec.player_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)" }}>{initials}</span>
                          }
                        </div>
                        {canDelete && (
                          <button
                            onClick={() => deleteRecord(rec.id, rec.workout_title)}
                            disabled={deletingId === rec.id}
                            style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", flexShrink: 0, opacity: deletingId === rec.id ? 0.6 : 1 }}
                          >
                            {deletingId === rec.id ? "…" : "🗑"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
