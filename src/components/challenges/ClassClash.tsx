// src/components/ClassClash.tsx
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  currentUserId: string;
  canManage: boolean;
}

interface ClassClashComp {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  first_place_pts: number;
  second_place_pts: number;
  is_active: boolean;
  awarded: boolean;
  created_at: string;
}

interface GradeTotal {
  grade: string;
  total: number;
  players: { id: string; name: string; avatar_url: string | null; count: number }[];
}

const GRADE_ORDER = [
  "Upperclassman (11th-12th Grade)",
  "Underclassman (9th-10th Grade)",
  "Alumni",
];

const GRADE_LABELS: Record<string, string> = {
  "Upperclassman (11th-12th Grade)": "Upperclassmen",
  "Underclassman (9th-10th Grade)":  "Underclassmen",
  "Alumni":                          "Alumni",
};

const GRADE_COLORS: Record<string, string> = {
  "Upperclassman (11th-12th Grade)": "#93b4ff",
  "Underclassman (9th-10th Grade)":  "var(--gold)",
  "Alumni":                          "#5de098",
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default function ClassClash({ currentUserId, canManage }: Props) {
  const [comps, setComps]           = useState<ClassClashComp[]>([]);
  const [active, setActive]         = useState<ClassClashComp | null>(null);
  const [totals, setTotals]         = useState<GradeTotal[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [awarding, setAwarding]     = useState(false);
  const [toast, setToast]           = useState("");

  // Create form state
  const [title, setTitle]         = useState("Class Clash");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [first, setFirst]         = useState("5");
  const [second, setSecond]       = useState("2");
  const [saving, setSaving]       = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("class_clash_competitions")
        .select("*")
        .order("created_at", { ascending: false });
      const all = data ?? [];
      setComps(all);
      const act = all.find((c: ClassClashComp) => c.is_active) ?? null;
      setActive(act);
      if (act) await loadTotals(act);
    } finally { setLoading(false); }
  }

  async function loadTotals(comp: ClassClashComp) {
    // Get all score_attempts in the competition window
    const { data: attempts } = await supabase
      .from("score_attempts")
      .select("player_id, attempted_at")
      .gte("attempted_at", comp.start_date)
      .lte("attempted_at", comp.end_date + "T23:59:59");

    // Get all player profiles with grade
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, avatar_url, grade_category")
      .eq("role", "player");

    const profileMap: Record<string, any> = {};
    (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

    // Count attempts per player
    const countByPlayer: Record<string, number> = {};
    (attempts ?? []).forEach((a: any) => {
      countByPlayer[a.player_id] = (countByPlayer[a.player_id] ?? 0) + 1;
    });

    // Group by grade
    const gradeMap: Record<string, GradeTotal> = {};
    GRADE_ORDER.forEach(g => { gradeMap[g] = { grade: g, total: 0, players: [] }; });

    Object.entries(countByPlayer).forEach(([pid, count]) => {
      const profile = profileMap[pid];
      if (!profile) return;
      const grade = profile.grade_category;
      if (!gradeMap[grade]) gradeMap[grade] = { grade, total: 0, players: [] };
      gradeMap[grade].total += count;
      gradeMap[grade].players.push({
        id: pid,
        name: profile.name,
        avatar_url: profile.avatar_url,
        count,
      });
    });

    // Sort players within each grade
    Object.values(gradeMap).forEach(g => {
      g.players.sort((a, b) => b.count - a.count);
    });

    // Sort grades by total
    const sorted = GRADE_ORDER
      .map(g => gradeMap[g])
      .filter(g => g !== undefined)
      .sort((a, b) => b.total - a.total);

    setTotals(sorted);
  }

  async function handleCreate() {
    if (!title || !startDate || !endDate) return;
    setSaving(true);
    try {
      // Deactivate any existing active comp
      await supabase
        .from("class_clash_competitions")
        .update({ is_active: false })
        .eq("is_active", true);

      const { error } = await supabase
        .from("class_clash_competitions")
        .insert({
          title,
          start_date: startDate,
          end_date: endDate,
          first_place_pts: parseInt(first) || 5,
          second_place_pts: parseInt(second) || 2,
          is_active: true,
          awarded: false,
        });
      if (error) throw error;
      showToast("Class Clash started! 🏆");
      setShowCreate(false);
      setTitle("Class Clash");
      setStartDate(""); setEndDate("");
      setFirst("5"); setSecond("2");
      await load();
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setSaving(false); }
  }

  async function handleAward() {
    if (!active || totals.length === 0) return;
    if (!window.confirm(`Award Class Clash points?\n\n🥇 ${GRADE_LABELS[totals[0]?.grade] ?? "1st"} — +${active.first_place_pts} pts each player\n🥈 ${GRADE_LABELS[totals[1]?.grade] ?? "2nd"} — +${active.second_place_pts} pts each player\n\nThis cannot be undone.`)) return;

    setAwarding(true);
    try {
      const now = new Date().toISOString();

      // Award 1st place
      if (totals[0]) {
        for (const player of totals[0].players) {
          await supabase.from("streak_bonuses").insert({
            player_id: player.id,
            points: active.first_place_pts,
            streak_length: 0,
            awarded_at: now,
            reason: "class_clash_1st",
          });
        }
      }

      // Award 2nd place
      if (totals[1]) {
        for (const player of totals[1].players) {
          await supabase.from("streak_bonuses").insert({
            player_id: player.id,
            points: active.second_place_pts,
            streak_length: 0,
            awarded_at: now,
            reason: "class_clash_2nd",
          });
        }
      }

      // Mark as awarded and inactive
      await supabase
        .from("class_clash_competitions")
        .update({ awarded: true, is_active: false })
        .eq("id", active.id);

      showToast("Points awarded! 🏆");
      await load();
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setAwarding(false); }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const maxTotal = Math.max(...totals.map(t => t.total), 1);
  const myGrade = totals.find(t =>
    t.players.some(p => p.id === currentUserId)
  );

  const now = new Date();
  const isEnded = active && new Date(active.end_date) < now;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)", letterSpacing: 1 }}>⚔️ Class Clash</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Grade vs grade · Outwork everyone</div>
        </div>
        {canManage && !showCreate && (
          <button onClick={() => setShowCreate(true)}
            style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
            + New Clash
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && canManage && (
        <div style={{ background: "var(--surface2)", border: "1px solid rgba(26,63,168,0.4)", borderRadius: 12, padding: 16, marginBottom: 16, marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>New Class Clash</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Title</div>
              <input value={title} onChange={e => setTitle(e.target.value)}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Start Date</div>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>End Date</div>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600, marginBottom: 8 }}>🏆 Prize — players will see this from day one</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>🥇 1st place pts (each player)</div>
                  <input type="number" value={first} onChange={e => setFirst(e.target.value)} min="1"
                    style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>🥈 2nd place pts (each player)</div>
                  <input type="number" value={second} onChange={e => setSecond(e.target.value)} min="0"
                    style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleCreate} disabled={saving || !title || !startDate || !endDate}
                style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                {saving ? "Starting…" : "Start Class Clash"}
              </button>
              <button onClick={() => setShowCreate(false)}
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0" }}>Loading…</div>
      ) : !active ? (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚔️</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1, marginBottom: 8 }}>No active Class Clash</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {canManage ? "Start one above to get the grades competing." : "Your coach will start the next Class Clash soon."}
          </div>
        </div>
      ) : (
        <>
          {/* Active competition header */}
          <div style={{ background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.25)", borderRadius: 12, padding: "12px 16px", marginBottom: 16, marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--gold)", marginBottom: 4 }}>{active.title}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              {new Date(active.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(active.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {isEnded ? <span style={{ color: "#ff7b7b", marginLeft: 8 }}>· Ended</span> : <span style={{ color: "#5de098", marginLeft: 8 }}>· Live</span>}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
              <span style={{ color: "var(--text)" }}>🥇 1st place: <strong style={{ color: "var(--gold)" }}>+{active.first_place_pts} pts</strong> each player</span>
              <span style={{ color: "var(--text)" }}>🥈 2nd place: <strong style={{ color: "#93b4ff" }}>+{active.second_place_pts} pts</strong> each player</span>
            </div>
          </div>

          {/* My grade callout */}
          {myGrade && (
            <div style={{ background: `rgba(${myGrade.grade.includes("Upper") ? "147,180,255" : myGrade.grade.includes("Under") ? "240,192,64" : "93,224,152"},0.08)`, border: `1px solid ${GRADE_COLORS[myGrade.grade]}33`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, color: "var(--text)" }}>
                You're competing for <strong style={{ color: GRADE_COLORS[myGrade.grade] }}>{GRADE_LABELS[myGrade.grade] ?? myGrade.grade}</strong>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: GRADE_COLORS[myGrade.grade] }}>
                {totals.findIndex(t => t.grade === myGrade.grade) === 0 ? "🥇 Leading!" :
                 totals.findIndex(t => t.grade === myGrade.grade) === 1 ? "🥈 2nd" : "🥉 3rd"}
              </div>
            </div>
          )}

          {/* Grade leaderboard */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {totals.map((grade, idx) => {
              const pct = Math.round((grade.total / maxTotal) * 100);
              const color = GRADE_COLORS[grade.grade] ?? "#93b4ff";
              const label = GRADE_LABELS[grade.grade] ?? grade.grade;
              const isMyGrade = grade.players.some(p => p.id === currentUserId);
              const [expanded, setExpanded] = useState(false);

              return (
                <div key={grade.grade} style={{ background: "var(--surface2)", border: `1px solid ${isMyGrade ? color + "44" : "var(--border)"}`, borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 20 }}>{MEDALS[idx] ?? `${idx + 1}`}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: idx === 0 ? "var(--gold)" : "var(--text)" }}>{label}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{grade.players.length} players</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color, lineHeight: 1 }}>{grade.total}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>workouts</div>
                      </div>
                    </div>
                    <div style={{ height: 8, background: "var(--border)", borderRadius: 99, overflow: "hidden", marginBottom: 8 }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: "width 0.5s" }} />
                    </div>
                    {grade.players.length > 0 && (
                      <button onClick={() => setExpanded(e => !e)}
                        style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 11, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                        {expanded ? "▲ Hide players" : `▼ Show ${grade.players.length} players`}
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div style={{ borderTop: "1px solid var(--border)", padding: "8px 16px" }}>
                      {grade.players.slice(0, 10).map((p, pi) => {
                        const isMe = p.id === currentUserId;
                        const initials = p.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
                        return (
                          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: pi < grade.players.length - 1 ? "1px solid var(--border)" : "none" }}>
                            <div style={{ fontSize: 11, color: "var(--muted)", width: 16, textAlign: "center" }}>{pi + 1}</div>
                            <div style={{ width: 24, height: 24, borderRadius: "50%", overflow: "hidden", background: "rgba(26,63,168,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: isMe ? `1.5px solid ${color}` : "none" }}>
                              {p.avatar_url ? <img src={p.avatar_url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 8, fontWeight: 700, color }}>{initials}</span>}
                            </div>
                            <div style={{ flex: 1, fontSize: 13, color: "var(--text)", fontWeight: isMe ? 700 : 400 }}>
                              {p.name}{isMe && <span style={{ color, marginLeft: 4, fontSize: 11 }}>(you)</span>}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color }}>{p.count}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {totals.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>No workouts logged yet. Get to work! 💪</div>
            )}
          </div>

          {/* Coach award button */}
          {canManage && isEnded && !active.awarded && (
            <div style={{ background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--gold)", marginBottom: 8 }}>Competition ended — ready to award points?</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                {totals[0] && <div>🥇 {GRADE_LABELS[totals[0].grade]} — +{active.first_place_pts} pts × {totals[0].players.length} players</div>}
                {totals[1] && <div>🥈 {GRADE_LABELS[totals[1].grade]} — +{active.second_place_pts} pts × {totals[1].players.length} players</div>}
              </div>
              <button onClick={handleAward} disabled={awarding}
                style={{ width: "100%", background: "var(--gold)", color: "#000", border: "none", borderRadius: 8, padding: "12px", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                {awarding ? "Awarding…" : "🏆 Award Points & Close Competition"}
              </button>
            </div>
          )}

          {canManage && active.awarded && (
            <div style={{ textAlign: "center", padding: "12px", fontSize: 13, color: "#5de098" }}>✓ Points awarded — competition complete</div>
          )}
        </>
      )}

      {/* Past competitions */}
      {comps.filter(c => !c.is_active && c.awarded).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Past Clashes</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {comps.filter(c => !c.is_active && c.awarded).map(c => (
              <div key={c.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", opacity: 0.7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{c.title}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {new Date(c.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(c.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#5de098" }}>✓ Complete</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
