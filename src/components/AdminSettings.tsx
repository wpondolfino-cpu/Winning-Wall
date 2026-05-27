// src/components/AdminSettings.tsx
import { useState, useEffect } from "react";
import { supabase, setPeriodAnchor, getPeriodAnchor, currentPeriodStart, currentPeriodEnd } from "../lib/supabase";

// ── Badge stored in Supabase ──────────────────────────────────
interface Badge {
  id: string;
  icon: string;
  name: string;
  description: string;
  trigger_type: "workouts" | "points" | "streak" | "champion" | "top_score";
  trigger_value: number;
  is_active: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  workouts:  "Workouts logged",
  points:    "Total points earned",
  streak:    "Day logging streak",
  champion:  "Won a biweekly period",
  top_score: "Scored #1 on any drill",
};

const DEFAULT_BADGES: Omit<Badge, "id">[] = [
  { icon: "🏀", name: "First Rep",       description: "Logged your first workout",        trigger_type: "workouts",  trigger_value: 1,   is_active: true },
  { icon: "💪", name: "Getting Reps",    description: "Logged 5 workouts",                trigger_type: "workouts",  trigger_value: 5,   is_active: true },
  { icon: "🔟", name: "Grinder",         description: "Logged 10 workouts",               trigger_type: "workouts",  trigger_value: 10,  is_active: true },
  { icon: "⚡", name: "Workhorse",       description: "Logged 25 workouts",               trigger_type: "workouts",  trigger_value: 25,  is_active: true },
  { icon: "🔥", name: "On Fire",         description: "3-day logging streak",             trigger_type: "streak",    trigger_value: 3,   is_active: true },
  { icon: "🌟", name: "Week Warrior",    description: "7-day logging streak",             trigger_type: "streak",    trigger_value: 7,   is_active: true },
  { icon: "💯", name: "Two Week Grind",  description: "14-day logging streak",            trigger_type: "streak",    trigger_value: 14,  is_active: true },
  { icon: "🥉", name: "On the Board",    description: "Earned 10 total points",           trigger_type: "points",    trigger_value: 10,  is_active: true },
  { icon: "🥈", name: "Rising Star",     description: "Earned 25 total points",           trigger_type: "points",    trigger_value: 25,  is_active: true },
  { icon: "🥇", name: "Elite",           description: "Earned 50 total points",           trigger_type: "points",    trigger_value: 50,  is_active: true },
  { icon: "💎", name: "Century Club",    description: "Earned 100 total points",          trigger_type: "points",    trigger_value: 100, is_active: true },
  { icon: "👑", name: "Champion",        description: "Won a biweekly period",            trigger_type: "champion",  trigger_value: 1,   is_active: true },
  { icon: "🎯", name: "Sharpshooter",    description: "Scored #1 on any drill",           trigger_type: "top_score", trigger_value: 1,   is_active: true },
];

export default function AdminSettings() {
  const [badges, setBadges]         = useState<Badge[]>([]);
  const [loading, setLoading]       = useState(true);
  const [editBadge, setEditBadge]   = useState<Badge | null>(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [toast, setToast]           = useState("");

  // New badge form state
  const [newIcon, setNewIcon]         = useState("🏅");
  const [newName, setNewName]         = useState("");
  const [newDesc, setNewDesc]         = useState("");
  const [newTrigger, setNewTrigger]   = useState<Badge["trigger_type"]>("workouts");
  const [newValue, setNewValue]       = useState("1");

  // Period settings
  const [anchorDate, setAnchorDate] = useState(() => getPeriodAnchor().toISOString().split("T")[0]);
  const [anchorSaved, setAnchorSaved] = useState(false);
  const [exporting, setExporting]   = useState(false);
  const [resetting, setResetting]   = useState(false);
  const [resetStep, setResetStep]   = useState(0);

  const periodStart = currentPeriodStart();
  const periodEnd   = currentPeriodEnd();
  const daysLeft    = Math.ceil((periodEnd.getTime() - Date.now()) / 86400000);

  useEffect(() => { loadBadges(); }, []);

  async function loadBadges() {
    setLoading(true);
    const { data, error } = await supabase.from("badges").select("*").order("trigger_type").order("trigger_value");
    if (error || !data || data.length === 0) {
      // Seed default badges if none exist
      await seedDefaultBadges();
    } else {
      setBadges(data);
    }
    setLoading(false);
  }

  async function seedDefaultBadges() {
    const { data } = await supabase.from("badges").insert(DEFAULT_BADGES).select();
    setBadges(data ?? []);
  }

  async function saveBadge() {
    if (!editBadge) return;
    setSaving(true);
    const { error } = await supabase.from("badges").update({
      icon: editBadge.icon,
      name: editBadge.name,
      description: editBadge.description,
      trigger_type: editBadge.trigger_type,
      trigger_value: editBadge.trigger_value,
      is_active: editBadge.is_active,
    }).eq("id", editBadge.id);
    if (!error) {
      setEditBadge(null);
      showToast("Badge updated! ✅");
      loadBadges();
    }
    setSaving(false);
  }

  async function addBadge() {
    if (!newName.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("badges").insert({
      icon: newIcon, name: newName, description: newDesc,
      trigger_type: newTrigger, trigger_value: parseInt(newValue) || 1,
      is_active: true,
    });
    if (!error) {
      setShowAdd(false);
      setNewIcon("🏅"); setNewName(""); setNewDesc(""); setNewValue("1");
      showToast("Badge created! 🏅");
      loadBadges();
    }
    setSaving(false);
  }

  async function deleteBadge(id: string) {
    if (!window.confirm("Delete this badge? Players who earned it will lose it.")) return;
    setDeleting(id);
    await supabase.from("badges").delete().eq("id", id);
    showToast("Badge deleted.");
    loadBadges();
    setDeleting(null);
  }

  async function toggleBadge(b: Badge) {
    await supabase.from("badges").update({ is_active: !b.is_active }).eq("id", b.id);
    loadBadges();
  }

  function saveAnchor() {
    setPeriodAnchor(new Date(anchorDate));
    setAnchorSaved(true);
    setTimeout(() => { setAnchorSaved(false); window.location.reload(); }, 1000);
  }

  async function exportLeaderboard() {
    setExporting(true);
    try {
      const { data: profiles } = await supabase.from("profiles").select("id,name,grade_category").eq("role", "player");
      const { data: scores }   = await supabase.from("scores").select("*");
      const { data: workouts } = await supabase.from("workouts").select("id,title");
      if (!profiles || !scores || !workouts) return;

      const headers = ["Player", "Grade", "Total Points", ...workouts.map(w => w.title)];
      const rows = profiles.map(p => {
        const total = scores.filter(s => s.player_id === p.id).reduce((sum, s) => sum + (s.points ?? 0), 0);
        const wPts = workouts.map(w => {
          const s = scores.find(sc => sc.player_id === p.id && sc.workout_id === w.id);
          return s ? `${s.made + s.reps} (${s.points}pts)` : "—";
        });
        return [p.name, p.grade_category ?? "—", total, ...wPts];
      });

      const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `winning-wall-${new Date().toLocaleDateString().replace(/\//g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  async function handleSeasonReset() {
    if (resetStep === 0) { setResetStep(1); return; }
    if (resetStep === 1) { setResetStep(2); return; }
    setResetting(true);
    try {
      // Records table preserved (all-time records survive resets)
      // Personal bests preserved — zero out points only so leaderboard resets
      // but players can still see and beat their best scores year to year
      await supabase.from("scores").update({ points: 0 }).neq("id", "00000000-0000-0000-0000-000000000000");
      // Delete score_attempts history (the per-attempt log) so history starts fresh
      await supabase.from("score_attempts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("streaks").delete().neq("player_id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("streak_bonuses").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("profiles").update({ is_period_champion: false, champion_since: null }).neq("id", "00000000-0000-0000-0000-000000000000");
      setResetStep(0);
      showToast("✅ Season reset complete!");
    } catch (e: any) {
      showToast("Error: " + e.message);
      setResetStep(0);
    } finally { setResetting(false); }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  const inputStyle = {
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "9px 12px", color: "var(--text)",
    fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%",
  } as const;

  const COMMON_EMOJIS = ["🏅","🏀","🔥","💪","⚡","🌟","🎯","👑","💯","🥇","🥈","🥉","💎","🏆","🎽","⏱️","🦅"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Period Settings ── */}
      <div className="card">
        <div className="card-title">📅 Biweekly Period Settings</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
          Set the start date of Period 1. All future 2-week periods calculate automatically from there.
        </div>
        <div style={{ background: "rgba(26,63,168,0.15)", border: "1px solid rgba(26,63,168,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Current Period</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>
            {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{daysLeft} days remaining</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140, maxWidth: 200 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Period 1 Start Date</label>
            <input type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)} style={inputStyle} />
          </div>
          <button onClick={saveAnchor} style={{
            background: anchorSaved ? "#5de098" : "var(--royal)", color: anchorSaved ? "#051a0a" : "#fff",
            border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600,
            fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", width: "100%",
          }}>{anchorSaved ? "✓ Saved!" : "Save Date"}</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
          💡 Set this to the first day of your offseason. The app handles everything else.
        </div>
      </div>

      {/* ── Export ── */}
      <div className="card">
        <div className="card-title">📊 Export Leaderboard</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
          Download the full leaderboard as a spreadsheet (CSV). Opens in Excel or Google Sheets.
        </div>
        <button onClick={exportLeaderboard} disabled={exporting} style={{
          background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10,
          padding: "10px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>{exporting ? "Exporting…" : "⬇️ Download CSV"}</button>
      </div>

      {/* ── Badge Manager ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>🏅 Milestone Badges</div>
          <button onClick={() => setShowAdd(s => !s)} style={{
            background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8,
            padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
          }}>{showAdd ? "✕ Cancel" : "+ New Badge"}</button>
        </div>

        {/* Add new badge form */}
        {showAdd && (
          <div style={{ background: "var(--surface2)", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>New Badge</div>

            {/* Emoji picker */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6 }}>Icon</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {COMMON_EMOJIS.map(e => (
                  <button key={e} onClick={() => setNewIcon(e)} style={{
                    background: newIcon === e ? "var(--royal)" : "var(--surface)",
                    border: `1px solid ${newIcon === e ? "var(--royal-light)" : "var(--border)"}`,
                    borderRadius: 8, padding: "5px 9px", fontSize: 18, cursor: "pointer",
                  }}>{e}</button>
                ))}
              </div>
              <input value={newIcon} onChange={e => setNewIcon(e.target.value)} placeholder="Or type any emoji" style={{ ...inputStyle, width: 120 }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Badge Name</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Iron Man" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Trigger</label>
                <select value={newTrigger} onChange={e => setNewTrigger(e.target.value as Badge["trigger_type"])} style={inputStyle}>
                  {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Description</label>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="e.g. Logged 30 workouts" style={inputStyle} />
              </div>
              {(newTrigger === "workouts" || newTrigger === "points" || newTrigger === "streak") && (
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                    {newTrigger === "workouts" ? "# of workouts" : newTrigger === "points" ? "# of points" : "# of days"}
                  </label>
                  <input type="number" value={newValue} onChange={e => setNewValue(e.target.value)} min="1" style={inputStyle} />
                </div>
              )}
            </div>

            <button onClick={addBadge} disabled={saving || !newName.trim()} className="btn-primary">
              {saving ? "Saving…" : "Create Badge"}
            </button>
          </div>
        )}

        {/* Badge list */}
        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: 16, textAlign: "center" }}>Loading badges…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {badges.map(b => (
              <div key={b.id} style={{
                background: "var(--surface2)", border: `1px solid ${b.is_active ? "var(--border)" : "rgba(176,184,200,0.08)"}`,
                borderRadius: 10, padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 12,
                opacity: b.is_active ? 1 : 0.5,
              }}>
                <div style={{ fontSize: 24, flexShrink: 0 }}>{b.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{b.description}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {TRIGGER_LABELS[b.trigger_type]}
                    {(b.trigger_type === "workouts" || b.trigger_type === "points" || b.trigger_type === "streak") && ` ≥ ${b.trigger_value}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {/* Active toggle */}
                  <button onClick={() => toggleBadge(b)} style={{
                    background: b.is_active ? "rgba(40,180,80,0.15)" : "var(--surface)",
                    border: `1px solid ${b.is_active ? "rgba(40,180,80,0.3)" : "var(--border)"}`,
                    color: b.is_active ? "#5de098" : "var(--muted)",
                    borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600,
                    fontFamily: "inherit", cursor: "pointer",
                  }}>{b.is_active ? "On" : "Off"}</button>
                  <button onClick={() => setEditBadge({ ...b })} style={{
                    background: "var(--surface)", border: "1px solid var(--border)",
                    color: "var(--silver-light)", borderRadius: 6, padding: "4px 10px",
                    fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                  }}>✏️</button>
                  <button onClick={() => deleteBadge(b.id)} disabled={deleting === b.id} style={{
                    background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)",
                    color: "#ff7b7b", borderRadius: 6, padding: "4px 10px",
                    fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                  }}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit badge modal */}
      {editBadge && (
        <div className="modal-overlay open" onClick={() => setEditBadge(null)}>
          <div className="log-modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditBadge(null)}>✕</button>
            <div className="modal-title">Edit Badge</div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6 }}>Icon</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {COMMON_EMOJIS.map(e => (
                  <button key={e} onClick={() => setEditBadge({ ...editBadge, icon: e })} style={{
                    background: editBadge.icon === e ? "var(--royal)" : "var(--surface2)",
                    border: `1px solid ${editBadge.icon === e ? "var(--royal-light)" : "var(--border)"}`,
                    borderRadius: 8, padding: "5px 9px", fontSize: 18, cursor: "pointer",
                  }}>{e}</button>
                ))}
              </div>
              <input value={editBadge.icon} onChange={e => setEditBadge({ ...editBadge, icon: e.target.value })} style={{ ...inputStyle, width: 120 }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
                <input value={editBadge.name} onChange={e => setEditBadge({ ...editBadge, name: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Trigger</label>
                <select value={editBadge.trigger_type} onChange={e => setEditBadge({ ...editBadge, trigger_type: e.target.value as Badge["trigger_type"] })} style={inputStyle}>
                  {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Description</label>
                <input value={editBadge.description} onChange={e => setEditBadge({ ...editBadge, description: e.target.value })} style={inputStyle} />
              </div>
              {(editBadge.trigger_type === "workouts" || editBadge.trigger_type === "points" || editBadge.trigger_type === "streak") && (
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                    {editBadge.trigger_type === "workouts" ? "# of workouts" : editBadge.trigger_type === "points" ? "# of points" : "# of days"}
                  </label>
                  <input type="number" value={editBadge.trigger_value} onChange={e => setEditBadge({ ...editBadge, trigger_value: parseInt(e.target.value) || 1 })} min="1" style={inputStyle} />
                </div>
              )}
            </div>

            <button className="btn-primary" onClick={saveBadge} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
      {/* ── Season Reset ── */}
      <div style={{ marginTop: 32, background: "rgba(255,60,60,0.05)", border: "2px solid rgba(255,60,60,0.2)", borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "#ff7b7b", letterSpacing: 1, marginBottom: 8 }}>
          🔄 Season / All-Time Reset
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 16 }}>
          Use this at the end of an offseason to start fresh. This will:
          <ul style={{ marginTop: 8, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Reset leaderboard points to zero (personal bests are preserved)</li>
            <li>Clear score history and attempt logs</li>
            <li>Reset all streaks to zero</li>
            <li>Clear biweekly champion status</li>
            <li>Keep all player accounts, workouts, badges and Hall of Fame intact</li>
          </ul>
        </div>

        {resetStep === 0 && (
          <button onClick={handleSeasonReset} style={{ background: "rgba(255,60,60,0.15)", color: "#ff7b7b", border: "1px solid rgba(255,60,60,0.4)", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
            🔄 Start Season Reset
          </button>
        )}

        {resetStep === 1 && (
          <div style={{ padding: "14px 16px", background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", borderRadius: 10 }}>
            <div style={{ fontWeight: 700, color: "#ff7b7b", marginBottom: 8 }}>⚠️ Are you sure? This will erase ALL scores.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleSeasonReset} style={{ background: "#ff3c3c", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                Yes, continue
              </button>
              <button onClick={() => setResetStep(0)} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {resetStep === 2 && (
          <div style={{ padding: "14px 16px", background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", borderRadius: 10 }}>
            <div style={{ fontWeight: 700, color: "#ff7b7b", marginBottom: 8 }}>🚨 FINAL CONFIRMATION — This cannot be undone!</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Type this to confirm you understand all scores will be permanently deleted.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleSeasonReset} disabled={resetting} style={{ background: "#ff3c3c", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                {resetting ? "Resetting…" : "🔄 RESET SEASON NOW"}
              </button>
              <button onClick={() => setResetStep(0)} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {toast && (
          <div style={{ marginTop: 12, padding: "8px 14px", background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", borderRadius: 8, fontSize: 13, color: "#5de098", fontWeight: 600 }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
