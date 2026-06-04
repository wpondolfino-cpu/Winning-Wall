// src/components/AdminPanel.tsx
import { useState, useEffect } from "react";
import { supabase, approveUser, rejectUser, Profile, TEAM_CATEGORIES, TEAM_COLORS, saveTeamCompetition, endTeamCompetition, getActiveTeamCompetition, TeamCompetition, getTeams, Team, getXpPerks, XpPerk } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
}


interface Badge { id?: string; icon: string; name: string; description: string; trigger_type: "workouts"|"points"|"streak"|"champion"|"top_score"|"challenges_won"|"team_wins"; trigger_value: number; is_active: boolean; }
const TRIGGER_LABELS: Record<string,string> = { workouts:"Workouts logged", points:"Total points earned", streak:"Day logging streak", champion:"Won a biweekly period", top_score:"Scored #1 on any drill", challenges_won:"Challenges won", team_wins:"Team competition wins" };
const EMOJI_GROUPS = [
  { label: "Basketball & Competition", emojis: ["🏀","⛹️","🏅","🥇","🥈","🥉","🎯","🏆","🥊","⚡"] },
  { label: "Achievement & Awards",     emojis: ["👑","💎","⭐","🌟","✨","🔥","💫","🎖️","🏵️","🎗️"] },
  { label: "Fitness & Strength",       emojis: ["💪","🦾","🏋️","🤸","🧠","❤️","🫀","💯","🔋","⚙️"] },
  { label: "Attitude & Character",     emojis: ["⚔️","🛡️","🤝","👊","🙌","👏","😤","🫡","🧊","🦿"] },
  { label: "Animals",                  emojis: ["🦁","🐺","🦅","🐉","🐆","🦊","🐻","🦈","🐯","🦏"] },
  { label: "Money & Grind",            emojis: ["💰","💵","💸","🤑","💳","🏦","📈","💹","🪙","💲"] },
  { label: "Food",                     emojis: ["🍕","🍗","🥩","🍔","🌮","🍜","🥗","🍱","🧆","🧃"] },
  { label: "Numbers & Milestones",     emojis: ["1️⃣","2️⃣","3️⃣","5️⃣","🔟","💯","📊","🗓️","⏱️","🔑"] },
];

const inputStyle = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box" as const };

export default function AdminPanel({}: Props) {
  const { leaderboard, loading: lbLoading, refresh: refreshLb } = useLeaderboard();
  const [loadingCoaches, setLoadingCoaches] = useState(true);

  // ── shared add form ──
  const [addEmail, setAddEmail]   = useState("");
  const [addPass, setAddPass]     = useState("");

  // ── shared invite ──
  const [inviteSending, setInviteSending] = useState(false);

  // ── edit person ──
  const [editSaving, setEditSaving]   = useState(false);
  const [editError, setEditError]     = useState("");
  const [removing, setRemoving]       = useState<string | null>(null);
  const [toast, setToast]             = useState("");
  const [pendingCoaches, setPendingCoaches] = useState<any[]>([]);
  const [approvingCoach, setApprovingCoach] = useState<string | null>(null);
  const [resetRequests, setResetRequests] = useState<any[]>([]);
  const [resettingPw, setResettingPw] = useState<string | null>(null);
  const [adminTab, setAdminTab]     = useState<"badges"|"xp"|"teams">("badges");

  // Badge state
  const [badges, setBadges]         = useState<Badge[]>([]);
  const [editBadge, setEditBadge]   = useState<Badge | null>(null);
  const [showNewBadge, setShowNewBadge] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(0);
  const [newIcon, setNewIcon]       = useState("🏆");
  const [newName, setNewName]       = useState("");
  const [newDesc, setNewDesc]       = useState("");
  const [newTrigger, setNewTrigger] = useState<Badge["trigger_type"]>("workouts");
  const [newValue, setNewValue]     = useState("1");
  // XP state
  const [xpPerks, setXpPerks]       = useState<XpPerk[]>([]);
  const [xpSaving, setXpSaving]     = useState(false);
  const [xpValues, setXpValues]     = useState({ workout: 10, challenge_sent: 2, challenge_done: 3 });
  const [xpEnabled, setXpEnabled]   = useState(true);
  const [xpToggling, setXpToggling] = useState(false);

  // ── Team competition state ──
  const [teamComp, setTeamComp]           = useState<TeamCompetition | null>(null);
  const [endingComp, setEndingComp]       = useState(false);
  const [activeTeams, setActiveTeams]     = useState<Team[]>([]);
  const [numTeams, setNumTeams]           = useState(2);
  const [teamCategory, setTeamCategory]   = useState("🏀 Basketball");
  const [bonusPoints, setBonusPoints]     = useState(10);
  const [teamStartDate, setTeamStartDate] = useState("");
  const [teamEndDate, setTeamEndDate]     = useState("");
  const [previewTeams, setPreviewTeams]   = useState<{name:string;color:string;players:Profile[]}[]>([]);
  const [teamSaving, setTeamSaving]       = useState(false);
  const [teamTogglingOff, setTeamTogglingOff] = useState(false);

  // ── edit scores ──

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  useEffect(() => {
    loadPendingCoaches();
    loadResetRequests();
    loadTeamData();
    loadBadges();
    loadXpSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTeamData() {
    const comp = await getActiveTeamCompetition();
    setTeamComp(comp);
    if (comp) {
      const teams = await getTeams(comp.id);
      setActiveTeams(teams);
    }
  }

  async function loadBadges() {
    const { data } = await supabase.from("badges").select("*").order("trigger_type").order("trigger_value");
    setBadges(data ?? []);
  }
  async function loadXpSettings() {
    const perks = await getXpPerks();
    setXpPerks(perks.filter(p => !p.perk_key.startsWith("_")));
    const { data: toggle } = await supabase.from("xp_settings").select("xp_required").eq("perk_key","_xp_enabled").single();
    const stored = localStorage.getItem("xp_enabled");
    setXpEnabled(stored !== "false" && toggle?.xp_required !== 0);
    // Load XP action values
    const { data: vals } = await supabase.from("xp_settings")
      .select("perk_key,xp_required")
      .in("perk_key", ["_xp_workout","_xp_challenge_sent","_xp_challenge_done"]);
    if (vals && vals.length > 0) {
      const v: any = {};
      vals.forEach((r: any) => { v[r.perk_key] = r.xp_required; });
      setXpValues({
        workout:        v["_xp_workout"]        ?? 10,
        challenge_sent: v["_xp_challenge_sent"] ?? 2,
        challenge_done: v["_xp_challenge_done"] ?? 3,
      });
    }
  }

  async function saveXpValue(key: string, val: number) {
    const names: Record<string,string> = {
      "_xp_workout": "XP per workout attempt",
      "_xp_challenge_sent": "XP per challenge sent",
      "_xp_challenge_done": "XP per challenge completed",
    };
    await supabase.from("xp_settings").upsert({
      perk_key: key, perk_name: names[key], xp_required: val,
      description: "XP action value", updated_at: new Date().toISOString(),
    }, { onConflict: "perk_key" });
    await loadXpSettings();
    showToast("✅ XP value saved!");
  }
  async function saveBadge() {
    if (!newName || !newIcon) { showToast("Please fill in icon and name."); return; }
    const { error } = await supabase.from("badges").insert({
      icon: newIcon, name: newName, description: newDesc,
      trigger_type: newTrigger, trigger_value: parseInt(newValue)||1, is_active: true
    });
    if (error) { showToast("Error: " + error.message); return; }
    await loadBadges();
    setNewName(""); setNewDesc(""); setNewIcon("🏆"); setNewValue("1");
    setShowNewBadge(false);
    showToast("✅ Badge added!");
  }
  async function updateBadge(b: Badge) {
    await supabase.from("badges").update({ icon: b.icon, name: b.name, description: b.description, trigger_type: b.trigger_type, trigger_value: b.trigger_value }).eq("id", b.id!);
    setEditBadge(null); await loadBadges(); showToast("Badge updated!");
  }
  async function deleteBadge(id: string) {
    if (!window.confirm("Delete this badge?")) return;
    await supabase.from("badges").delete().eq("id", id);
    await loadBadges(); showToast("Badge deleted.");
  }
  async function toggleBadgeActive(b: Badge) {
    await supabase.from("badges").update({ is_active: !b.is_active }).eq("id", b.id!);
    await loadBadges();
  }
  async function saveXpPerk(perk: XpPerk, newXp: number) {
    setXpSaving(true);
    await supabase.from("xp_settings").upsert({ perk_key: perk.perk_key, perk_name: perk.perk_name, xp_required: newXp, description: perk.description, updated_at: new Date().toISOString() }, { onConflict: "perk_key" });
    await loadXpSettings(); setXpSaving(false); showToast("✅ XP threshold saved!");
  }
  async function toggleXpSystem() {
    setXpToggling(true);
    const newVal = !xpEnabled;
    setXpEnabled(newVal);
    localStorage.setItem("xp_enabled", String(newVal));
    await supabase.from("xp_settings").upsert({ perk_key: "_xp_enabled", perk_name: "XP System Enabled", xp_required: newVal ? 1 : 0, description: "Master toggle", updated_at: new Date().toISOString() }, { onConflict: "perk_key" });
    setXpToggling(false);
    showToast(newVal ? "✅ XP system is now ON" : "⏸️ XP system is now OFF — all perks unlocked for everyone");
  }

  async function randomizeTeams() {
    // Get all active players — only those with enough XP for team eligibility (300 XP)
    const { data: allPlayers } = await supabase.from("profiles")
      .select("id,name,grade_category,avatar_url,total_xp")
      .eq("role", "player")
      .order("name");
    // Only gate by XP if XP system is enabled
    const players = xpEnabled
      ? (allPlayers ?? []).filter((p: any) => (p.total_xp ?? 0) >= 300)
      : (allPlayers ?? []);
    if (players.length < numTeams) {
      showToast(`Not enough ${xpEnabled ? "eligible (300+ XP) " : ""}players (need ${numTeams}, have ${players.length}).`);
      return;
    }
    if (!players) return;

    // Split by grade
    const upper = players.filter((p:any) => p.grade_category?.includes("11") || p.grade_category?.includes("12") || p.grade_category?.includes("Upper"));
    const lower = players.filter((p:any) => !upper.includes(p));

    // Shuffle both groups
    const shuffle = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5);

    // Pick random names from category
    const names = [...TEAM_CATEGORIES[teamCategory]];
    const shuffledNames = shuffle(names).slice(0, numTeams);

    // Create teams
    const teams: {name:string;color:string;players:Profile[]}[] =
      shuffledNames.map((name, i) => ({ name, color: TEAM_COLORS[i % TEAM_COLORS.length], players: [] }));

    // Shuffle ALL players together randomly then distribute round-robin
    // This guarantees even teams with natural grade mixing
    const allShuffled = shuffle(players);
    allShuffled.forEach((p, i) => teams[i % numTeams].players.push(p as Profile));

    setPreviewTeams(teams);
  }

  async function confirmTeams() {
    if (previewTeams.length === 0) return;
    if (!teamStartDate || !teamEndDate) { showToast("Please set start and end dates."); return; }
    setTeamSaving(true);
    try {
      const assignments: Record<string, string[]> = {};
      previewTeams.forEach((t: any) => { assignments[t.name] = t.players.map((p: any) => p.id); });
      await saveTeamCompetition(
        numTeams, previewTeams.map(t => t.name), assignments,
        bonusPoints, teamStartDate, teamEndDate
      );
      await loadTeamData();
      setPreviewTeams([]);
      showToast("✅ Team competition started!");
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setTeamSaving(false); }
  }

  async function handleToggleTeams(active: boolean) {
    setTeamTogglingOff(true);
    try {
      await supabase.from("team_competitions").update({ is_active: active })
        .eq("id", teamComp?.id ?? "");
      await loadTeamData();
      showToast(active ? "Team competition is now ON 🎯" : "Team competition is now OFF");
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setTeamTogglingOff(false); }
  }

  async function loadResetRequests() {
    const { data } = await supabase
      .from("password_reset_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    setResetRequests(data ?? []);
  }

  async function handleResetPassword(req: any) {
    if (!window.confirm(`Reset ${req.name}'s password to "Bombardiers1!"?\n\nThey'll be prompted to change it on next login.`)) return;
    setResettingPw(req.id);
    try {
      // Reset password via RPC
      if (req.player_id) {
        await supabase.rpc("reset_user_password", {
          target_user_id: req.player_id,
          new_password: "Bombardiers1!"
        });
        // Set must_change_password so they get prompted
        await supabase.from("profiles")
          .update({ must_change_password: true })
          .eq("id", req.player_id);
      }
      // Mark request as done
      await supabase.from("password_reset_requests")
        .update({ status: "done" })
        .eq("id", req.id);
      await loadResetRequests();
      showToast(`✅ Password reset for ${req.name}!`);
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setResettingPw(null); }
  }

  async function handleDismissRequest(id: string) {
    await supabase.from("password_reset_requests")
      .update({ status: "dismissed" })
      .eq("id", id);
    await loadResetRequests();
  }

  async function loadPendingCoaches() {
    const { data } = await supabase.from("profiles")
      .select("id,name,role,created_at,email")
      .eq("role", "pending_coach")
      .order("created_at", { ascending: true });
    setPendingCoaches(data ?? []);
  }

  async function handleApproveCoach(id: string) {
    setApprovingCoach(id);
    try {
      await approveUser(id, "coach");
      await loadPendingCoaches();
      showToast("Coach approved! 🏀");
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setApprovingCoach(null); }
  }

  async function handleRejectCoach(id: string, name: string) {
    if (!window.confirm(`Reject coach request from "${name}"? This deletes their account.`)) return;
    setApprovingCoach(id);
    try {
      await rejectUser(id);
      await loadPendingCoaches();
      showToast("Request rejected.");
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setApprovingCoach(null); }
  }






  return (
    <div className="panel active">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div className="section-title">Admin Panel</div>
        <span style={{ background: "rgba(240,192,64,0.2)", color: "var(--gold)", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(240,192,64,0.3)" }}>ADMIN</span>
      </div>
      <div className="section-sub">Full control — manage players, coaches, and accounts</div>

      {/* ── Admin Tabs ── */}
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 10, padding: 4, marginBottom: 20, border: "1px solid var(--border)" }}>
        {([["badges","🏅 Badges"],["xp","⚡ XP"],["teams","🏆 Teams"]] as const).map(([tab, label]) => (
          <button key={tab} onClick={() => setAdminTab(tab)} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 600,
            background: adminTab === tab ? "var(--royal)" : "transparent",
            color: adminTab === tab ? "#fff" : "var(--muted)",
            transition: "all 0.15s",
          }}>{label}</button>
        ))}
      </div>

      {/* ══ BADGES TAB ══ */}
      {adminTab === "badges" && (
        <div>
          {/* Header + New Badge button */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1 }}>🏅 Badge Manager</div>
            <button onClick={() => { setShowNewBadge(s => !s); setEditBadge(null); }} style={{
              background: showNewBadge ? "var(--surface)" : "var(--royal)", color: showNewBadge ? "var(--muted)" : "#fff",
              border: `1px solid ${showNewBadge ? "var(--border)" : "var(--royal)"}`,
              borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}>{showNewBadge ? "✕ Cancel" : "➕ New Badge"}</button>
          </div>

          {/* New badge form - slides open */}
          {showNewBadge && (
            <div className="card" style={{ marginBottom: 20, border: "1px solid rgba(26,63,168,0.4)", background: "rgba(26,63,168,0.05)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 14, textTransform: "uppercase", letterSpacing: 0.5 }}>New Badge</div>

              {/* Emoji picker */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 8 }}>Icon</label>

                {/* Category tabs */}
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 8 }}>
                  {EMOJI_GROUPS.map((group, i) => (
                    <button key={i} onClick={() => setEmojiCategory(i)} style={{
                      flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 12px", borderRadius: 20, border: `1px solid ${emojiCategory === i ? "var(--royal)" : "var(--border)"}`,
                      background: emojiCategory === i ? "rgba(26,63,168,0.15)" : "var(--surface)",
                      color: emojiCategory === i ? "#93b4ff" : "var(--muted)",
                      cursor: "pointer", fontSize: 12, fontWeight: emojiCategory === i ? 700 : 400,
                      fontFamily: "inherit", whiteSpace: "nowrap",
                    }}>
                      <span style={{ fontSize: 16 }}>{group.emojis[0]}</span>
                      {group.label.split(" ")[0]}
                    </button>
                  ))}
                </div>

                {/* Emoji row for selected category */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "10px 12px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)", marginBottom: 10 }}>
                  {EMOJI_GROUPS[emojiCategory].emojis.map(e => (
                    <button key={e} onClick={() => setNewIcon(e)} style={{
                      fontSize: 24, padding: "6px 8px", borderRadius: 8,
                      border: `1.5px solid ${newIcon === e ? "var(--royal)" : "transparent"}`,
                      background: newIcon === e ? "rgba(26,63,168,0.15)" : "transparent",
                      cursor: "pointer", lineHeight: 1, transition: "all 0.1s",
                    }}>{e}</button>
                  ))}
                </div>

                {/* Type your own + preview */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 36, width: 50, height: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, flexShrink: 0 }}>{newIcon || "🏆"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Or type / paste your own</div>
                    <input value={newIcon} onChange={e => setNewIcon(e.target.value)} placeholder="🏆"
                      style={{ ...inputStyle, fontSize: 20, textAlign: "center" }} />
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 12 }}>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Badge Name</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Grinder" style={inputStyle} /></div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Trigger Type</label>
                <select value={newTrigger} onChange={e => setNewTrigger(e.target.value as Badge["trigger_type"])} style={inputStyle}>
                  {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Description</label>
                  <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="e.g. Logged 30 workouts" style={inputStyle} /></div>
                {(newTrigger === "workouts" || newTrigger === "points" || newTrigger === "streak" || newTrigger === "challenges_won" || newTrigger === "team_wins") && (
                  <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                    {newTrigger === "workouts" ? "# of workouts" : newTrigger === "points" ? "# of points" : newTrigger === "streak" ? "# of days" : newTrigger === "challenges_won" ? "# of wins" : "# of team wins"}
                  </label>
                  <input type="number" value={newValue} onChange={e => setNewValue(e.target.value)} min="1" style={inputStyle} /></div>
                )}
              </div>
              <button onClick={async () => { await saveBadge(); }} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                ➕ Add Badge
              </button>
            </div>
          )}

          {/* Badge list */}
          {badges.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)", padding: "20px 0" }}>No badges yet. Click "New Badge" to create one.</div>
          ) : (() => {
            const CATEGORY_META: Record<string, { label: string; icon: string }> = {
              workouts:       { label: "Workouts",         icon: "🏀" },
              points:         { label: "Points",           icon: "⭐" },
              streak:         { label: "Streaks",          icon: "🔥" },
              challenges_won: { label: "Head to Head",     icon: "⚔️" },
              team_wins:      { label: "Team Competition", icon: "🏆" },
              champion:       { label: "Period Champion",  icon: "👑" },
              top_score:      { label: "Top Score",        icon: "🥇" },
            };
            const groups: Record<string, Badge[]> = {};
            badges.forEach(b => {
              const key = b.trigger_type ?? "manual";
              if (!groups[key]) groups[key] = [];
              groups[key].push(b);
            });
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {Object.entries(groups).map(([type, groupBadges]) => {
                  const meta = CATEGORY_META[type] ?? { label: type, icon: "🏅" };
                  return (
                    <div key={type}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: 14 }}>{meta.icon}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8 }}>{meta.label}</span>
                        <div style={{ flex: 1, height: 1, background: "var(--border)", marginLeft: 4 }} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {groupBadges.map(b => (
                          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                            <span style={{ fontSize: 22 }}>{b.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{b.name}</div>
                              <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.description} · {TRIGGER_LABELS[b.trigger_type]} ≥ {b.trigger_value}</div>
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <button onClick={() => { setEditBadge(b); setShowNewBadge(false); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>✏️</button>
                              <button onClick={() => deleteBadge(b.id!)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#ff7b7b" }}>🗑</button>
                              <button onClick={() => toggleBadgeActive(b)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 700, background: b.is_active ? "rgba(40,180,80,0.15)" : "var(--surface)", color: b.is_active ? "#5de098" : "var(--muted)" }}>
                                {b.is_active ? "ON" : "OFF"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Edit badge form */}
          {editBadge && (
            <div style={{ marginTop: 16, background: "var(--surface2)", borderRadius: 10, padding: "14px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase" }}>Edit Badge</div>
              <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 10, marginBottom: 10 }}>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Icon</label>
                  <input value={editBadge.icon} onChange={e => setEditBadge({ ...editBadge, icon: e.target.value })} style={inputStyle} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
                  <input value={editBadge.name} onChange={e => setEditBadge({ ...editBadge, name: e.target.value })} style={inputStyle} /></div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Trigger Type</label>
                <select value={editBadge.trigger_type} onChange={e => setEditBadge({ ...editBadge, trigger_type: e.target.value as Badge["trigger_type"] })} style={inputStyle}>
                  {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Description</label>
                  <input value={editBadge.description} onChange={e => setEditBadge({ ...editBadge, description: e.target.value })} style={inputStyle} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Value</label>
                  <input type="number" value={editBadge.trigger_value} onChange={e => setEditBadge({ ...editBadge, trigger_value: parseInt(e.target.value) })} style={inputStyle} /></div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => updateBadge(editBadge)} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Save</button>
                <button onClick={() => setEditBadge(null)} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ XP TAB ══ */}
      {adminTab === "xp" && (
        <div>
          {/* XP on/off toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16, padding: "12px 16px", background: "var(--surface2)", borderRadius: 12, border: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>⚡ XP System</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>When off, all perks and challenges are unlocked for everyone</div>
            </div>
            <button onClick={toggleXpSystem} disabled={xpToggling} style={{
              background: xpEnabled ? "rgba(40,180,80,0.15)" : "rgba(255,107,107,0.15)",
              color: xpEnabled ? "#5de098" : "#ff7b7b",
              border: `1px solid ${xpEnabled ? "rgba(40,180,80,0.3)" : "rgba(255,107,107,0.3)"}`,
              borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700,
              fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
            }}>{xpToggling ? "Updating…" : xpEnabled ? "🟢 ON — Turn Off" : "🔴 OFF — Turn On"}</button>
          </div>

          {/* XP per action */}
          <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px", marginBottom: 16 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 14 }}>XP Per Action</div>
            {[
              { key: "_xp_workout",        label: "🏀 Workout attempt",     field: "workout" as const },
              { key: "_xp_challenge_sent", label: "⚔️ Challenge sent",      field: "challenge_sent" as const },
              { key: "_xp_challenge_done", label: "✅ Challenge completed",  field: "challenge_done" as const },
            ].map(({ key, label, field }) => (
              <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 13, color: "var(--text)" }}>{label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="number" inputMode="numeric" defaultValue={xpValues[field]}
                    onBlur={e => { const v = parseInt(e.target.value); if (v > 0) { setXpValues(prev => ({ ...prev, [field]: v })); saveXpValue(key, v); } }}
                    style={{ width: 64, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, textAlign: "center" }} />
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>XP</span>
                </div>
              </div>
            ))}
          </div>

          {/* Perk thresholds */}
          <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px" }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 14 }}>Perk Unlock Thresholds</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {xpPerks.map((perk, i) => (
                <div key={perk.perk_key} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{["⚔️","🤝","🛡️","💪","⚡"][i]} {perk.perk_name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{perk.description}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="number" inputMode="numeric" defaultValue={perk.xp_required}
                      onBlur={e => saveXpPerk(perk, parseInt(e.target.value) || perk.xp_required)}
                      style={{ width: 80, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, textAlign: "center" }} />
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>XP</span>
                  </div>
                </div>
              ))}
            </div>
            {xpSaving && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Saving…</div>}
          </div>
        </div>
      )}

      {adminTab === "teams" && (
        <div>
      <div style={{ marginTop: 32 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1, marginBottom: 16 }}>
          🏆 Team Competition
        </div>

        {/* Active competition status */}
        {teamComp && (
          <div style={{ background: teamComp.is_active ? "rgba(40,180,80,0.08)" : "rgba(255,107,107,0.08)", border: `1px solid ${teamComp.is_active ? "rgba(40,180,80,0.3)" : "rgba(255,107,107,0.3)"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: teamComp.is_active ? "#5de098" : "#ff7b7b" }}>
                {teamComp.is_active ? "🟢 Competition Active" : "🔴 Competition Inactive"}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                {teamComp.start_date && `${teamComp.start_date} – ${teamComp.end_date} · `}
                Bonus: +{teamComp.bonus_points} pts · {activeTeams.length} teams
              </div>
              <button onClick={async () => {
                if (!window.confirm("End this competition and award bonus points to the winning team?")) return;
                setEndingComp(true);
                try {
                  const result = await endTeamCompetition(teamComp.id);
                  if (result) {
                    showToast(`🏆 ${result.winnerName} wins with ${result.winnerScore} pts! Bonus points awarded.`);
                    await loadTeamData();
                  }
                } catch(e: any) { showToast("Error: " + e.message); }
                finally { setEndingComp(false); }
              }} disabled={endingComp} style={{
                background: "rgba(240,192,64,0.15)", border: "1px solid rgba(240,192,64,0.4)",
                color: "var(--gold)", borderRadius: 8, padding: "7px 14px",
                fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", marginTop: 8,
              }}>{endingComp ? "Ending…" : "🏆 End Competition & Award Winner"}
              </button>
            </div>
            <button onClick={() => handleToggleTeams(!teamComp.is_active)} disabled={teamTogglingOff}
              style={{ background: teamComp.is_active ? "rgba(255,107,107,0.15)" : "rgba(40,180,80,0.15)", color: teamComp.is_active ? "#ff7b7b" : "#5de098", border: `1px solid ${teamComp.is_active ? "rgba(255,107,107,0.3)" : "rgba(40,180,80,0.3)"}`, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>
              {teamTogglingOff ? "Updating…" : teamComp.is_active ? "Turn Off" : "Turn On"}
            </button>
          </div>
        )}

        {/* Setup form */}
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>
            {teamComp ? "Create New Competition" : "Set Up Team Competition"}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Number of Teams</label>
              <select value={numTeams} onChange={e => setNumTeams(Number(e.target.value))}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}>
                <option value={2}>2 Teams</option>
                <option value={3}>3 Teams</option>
                <option value={4}>4 Teams</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Bonus Points (winner)</label>
              <input type="number" inputMode="numeric" value={bonusPoints} onChange={e => setBonusPoints(Number(e.target.value))} min={1}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", MozAppearance: "textfield" } as React.CSSProperties} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name Category</label>
            <select value={teamCategory} onChange={e => setTeamCategory(e.target.value)}
              style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}>
              {Object.keys(TEAM_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Start Date</label>
              <input type="date" value={teamStartDate} onChange={e => setTeamStartDate(e.target.value)}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: teamStartDate ? "var(--text)" : "var(--muted)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", colorScheme: "dark" } as React.CSSProperties} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>End Date</label>
              <input type="date" value={teamEndDate} onChange={e => setTeamEndDate(e.target.value)}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: teamEndDate ? "var(--text)" : "var(--muted)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", colorScheme: "dark" } as React.CSSProperties} />
            </div>
          </div>

          <button onClick={randomizeTeams}
            style={{ width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", marginBottom: 12 }}>
            🎲 Randomize Teams
          </button>

          {/* Preview */}
          {previewTeams.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, fontWeight: 600 }}>Preview — re-randomize or confirm:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {previewTeams.map(team => (
                  <div key={team.name} style={{ background: "var(--surface)", borderRadius: 10, padding: "12px 14px", borderLeft: `4px solid ${team.color}` }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: team.color, marginBottom: 8 }}>{team.name}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {team.players.map((p: any) => (
                        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 5, background: "var(--surface2)", borderRadius: 20, padding: "3px 10px 3px 4px", fontSize: 11 }}>
                          <div style={{ width: 20, height: 20, borderRadius: "50%", background: team.color + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: team.color }}>
                            {p.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase()}
                          </div>
                          <span style={{ color: "var(--text)" }}>{p.name.split(" ")[0]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={confirmTeams} disabled={teamSaving}
                style={{ width: "100%", marginTop: 12, background: "#5de098", color: "#051a0a", border: "none", borderRadius: 8, padding: "10px", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                {teamSaving ? "Saving…" : "✅ Confirm Teams"}
              </button>
            </div>
          )}
        </div>
      </div>

        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
