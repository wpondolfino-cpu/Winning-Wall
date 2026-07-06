import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "./hooks/useAuth";
import { useWorkouts } from "./hooks/useWorkouts";
import { getMyScores, getAllScores, signOut, Score, Profile, getPlayerXp, getXpPerks, checkUnseenPerks, loadPeriodAnchor } from "./lib/supabase";
import ProfileEditor from "./components/ProfileEditor";
import ProfilePage from "./components/ProfilePage";
import NotificationOptIn from "./components/NotificationOptIn";
import { ensurePushTag } from "./lib/onesignal";
import LoginPage from "./pages/LoginPage";
import WorkoutsPanel from "./components/WorkoutsPanel";
import CoachPanel from "./components/coach/CoachPanel";
import Leaderboard from "./components/Leaderboard";
import HallOfFame from "./components/HallOfFame";
import ProgressPanel from "./components/ProgressPanel";
import PlayersPanel from "./components/PlayersPanel";
import AdminPanel from "./components/AdminPanel";
import AdminSettings from "./components/AdminSettings";
import InstallPrompt from "./components/InstallPrompt";
import ChangePassword from "./components/ChangePassword";
import ChallengesPanel from "./components/challenges/ChallengesPanel";
import PerkTutorial from "./components/PerkTutorial";
import LiftingPanel from "./components/lifting";
import AnnouncementPanel from "./components/coach/AnnouncementPanel";
import SendNotificationPanel from "./components/coach/SendNotificationPanel";
import ChampionsPanel from "./components/coach/ChampionsPanel";
import NavReorderModal, { NavItemConfig } from "./components/NavReorderModal";

type PlayerTab = "workouts" | "leaderboard" | "lifting" | "h2h" | "hof" | "profile" | "progress" | "more";
type CoachTab  = "workouts" | "leaderboard" | "players" | "hof" | "lifting" | "challenges" | "announcements" | "profile";
type AdminTab  = "workouts" | "leaderboard" | "players" | "hof" | "lifting" | "admin" | "settings" | "challenges" | "announcements" | "profile";

const COACH_NAV_CONFIG: NavItemConfig[] = [
  { key: "workouts",      icon: "➕", label: "Manage Workouts" },
  { key: "leaderboard",   icon: "🏆", label: "Leaderboard" },
  { key: "lifting",       icon: "💪", label: "Lifting Programs" },
  { key: "players",       icon: "👥", label: "Players & Coaches" },
  { key: "hof",           icon: "👑", label: "Hall of Fame" },
  { key: "challenges",    icon: "⚔️", label: "Challenges" },
  { key: "announcements", icon: "📢", label: "Announcements" },
  { key: "profile",       icon: "👤", label: "My Profile" },
];
const COACH_NAV_DEFAULT_ORDER = COACH_NAV_CONFIG.map(i => i.key);

const ADMIN_NAV_CONFIG: NavItemConfig[] = [
  { key: "workouts",      icon: "➕", label: "Manage Workouts" },
  { key: "leaderboard",   icon: "🏆", label: "Leaderboard" },
  { key: "lifting",       icon: "💪", label: "Lifting Programs" },
  { key: "players",       icon: "👥", label: "Players & Coaches" },
  { key: "hof",           icon: "👑", label: "Hall of Fame" },
  { key: "challenges",    icon: "⚔️", label: "Challenges" },
  { key: "announcements", icon: "📢", label: "Announcements" },
  { key: "admin",         icon: "👑", label: "Admin" },
  { key: "settings",      icon: "⚙️", label: "Settings" },
  { key: "profile",       icon: "👤", label: "My Profile" },
];
const ADMIN_NAV_DEFAULT_ORDER = ADMIN_NAV_CONFIG.map(i => i.key);

export default function App() {
  const { user, profile, authState } = useAuth();
  const { workouts, refresh: refreshWorkouts } = useWorkouts();
  const [myScores, setMyScores]     = useState<Score[]>([]);
  const [allScores, setAllScores]   = useState<Score[]>([]);
  const [playerTab, setPlayerTab]   = useState<PlayerTab>("workouts");
  const swipeTabs: PlayerTab[]        = ["workouts", "leaderboard", "h2h", "lifting", "more"];
  const touchStartX                   = useRef(0);
  const pullStartY                    = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing]   = useState(false);

  const [newPerkCount, setNewPerkCount] = useState(0);
  const [perkToast, setPerkToast]       = useState("");

  function handleSwipeStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    pullStartY.current  = e.touches[0].clientY;
  }
  function handleSwipeMove(e: React.TouchEvent) {
    if (refreshing) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    const dx = Math.abs(touchStartX.current - e.touches[0].clientX);
    if (dy > 0 && dx < 30 && (e.currentTarget as HTMLElement).scrollTop === 0) {
      setPullDistance(Math.min(dy * 0.4, 70));
    }
  }

  async function handleSwipeEnd(e: React.TouchEvent) {
    const diffX = touchStartX.current - e.changedTouches[0].clientX;
    const diffY = e.changedTouches[0].clientY - pullStartY.current;
    if (diffY > 60 && Math.abs(diffX) < 30 && pullDistance > 40) {
      setPullDistance(0); setRefreshing(true);
      await loadMyScores();
      setTimeout(() => setRefreshing(false), 600);
      return;
    }
    setPullDistance(0);
    if (Math.abs(diffX) < 60) return;
    const idx = swipeTabs.indexOf(playerTab);
    if (idx === -1) return;
    if (diffX > 0 && idx < swipeTabs.length - 1) setPlayerTab(swipeTabs[idx + 1]);
    if (diffX < 0 && idx > 0) setPlayerTab(swipeTabs[idx - 1]);
  }

  const [coachTab, setCoachTab]     = useState<CoachTab>("workouts");
  const [adminTab, setAdminTab]     = useState<AdminTab>("workouts");
  const [coachNavOrder, setCoachNavOrder] = useState<string[]>(COACH_NAV_DEFAULT_ORDER);
  const [adminNavOrder, setAdminNavOrder] = useState<string[]>(ADMIN_NAV_DEFAULT_ORDER);
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [pendingChallenges, setPendingChallenges] = useState(0);
  const [pendingApprovals, setPendingApprovals]   = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [playerXp, setPlayerXp]       = useState(0);
  const [xpPerks, setXpPerks]         = useState<any[]>([]);
  const [xpEnabled, setXpEnabled]     = useState(true);
  const [localProfile, setLocalProfile] = useState<Profile | null>(null);

  useEffect(() => { loadPeriodAnchor().catch(console.error); }, []);

  useEffect(() => {
    if (!profile) return;
    const saved = (profile as any).nav_order as string[] | null;
    if (profile.role === "coach") {
      const validKeys = new Set(COACH_NAV_DEFAULT_ORDER);
      const merged = saved
        ? [...saved.filter(k => validKeys.has(k)), ...COACH_NAV_DEFAULT_ORDER.filter(k => !saved.includes(k))]
        : COACH_NAV_DEFAULT_ORDER;
      setCoachNavOrder(merged);
    } else if (profile.role === "admin") {
      const validKeys = new Set(ADMIN_NAV_DEFAULT_ORDER);
      const merged = saved
        ? [...saved.filter(k => validKeys.has(k)), ...ADMIN_NAV_DEFAULT_ORDER.filter(k => !saved.includes(k))]
        : ADMIN_NAV_DEFAULT_ORDER;
      setAdminNavOrder(merged);
    }
  }, [profile]);

  useEffect(() => {
    if (user && profile?.role === "player") loadMyScores();
    if (user && (profile?.role === "coach" || profile?.role === "admin")) loadAllScores();
  }, [user, profile]);

  // Self-heal push subscriptions: if this device already granted browser
  // notification permission but never got fully opted in on OneSignal's
  // backend (e.g. from earlier testing), fix it silently on load.
  useEffect(() => {
    if (user && (profile?.role === "player" || profile?.role === "coach" || profile?.role === "admin")) ensurePushTag(user.id);
  }, [user, profile]);

  const checkNewPerks = useCallback(async () => {
    if (!user || profile?.role !== "player") return;
    try {
      const [xp, perks] = await Promise.all([getPlayerXp(user.id), getXpPerks()]);
      const unseen = await checkUnseenPerks(user.id, xp, perks);
      if (unseen.length > 0) {
        setNewPerkCount(unseen.length);
        const PERK_NAMES: Record<string, string> = {
          challenges_unlocked: "⚔️ Challenges Unlocked",
          team_eligible:       "👥 Team Eligible",
          streak_shield:       "🛡️ Streak Shield",
          team_bonus:          "⚡ Team Boost",
          score_boost:         "💪 Score Boost",
        };
        const name = PERK_NAMES[unseen[0]] ?? "New Perk";
        setPerkToast(`🎁 ${name} — check your Profile!`);
        setTimeout(() => setPerkToast(""), 4000);
      } else {
        setNewPerkCount(0);
      }
    } catch (e) { console.error("checkNewPerks error:", e); }
  }, [user, profile]);

  useEffect(() => {
    if (!user) return;
    async function checkPendingApprovals() {
      const { supabase: sb } = await import("./lib/supabase");
      const { count: pendingCount } = await sb.from("profiles").select("id", { count: "exact", head: true }).in("role", ["pending_player", "pending_coach"]);
      const { count: resetCount } = await sb.from("password_reset_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
      setPendingApprovals((pendingCount ?? 0) + (resetCount ?? 0));
    }
    checkPendingApprovals();
    const approvalInterval = setInterval(checkPendingApprovals, 60000);
    return () => clearInterval(approvalInterval);
  }, [user]);

  useEffect(() => {
    if (!user || profile?.role !== "player") return;
    async function checkChallenges() {
      const { supabase: sb } = await import("./lib/supabase");
      const { count } = await sb.from("challenges").select("id", { count: "exact", head: true }).eq("opponent_id", user!.id).eq("status", "pending").eq("opponent_seen", false);
      const { data: newTeam } = await sb.from("team_competitions").select("id,created_at").eq("is_active", true).gte("created_at", new Date(Date.now() - 86400000).toISOString()).single();
      const dismissedTeamId = localStorage.getItem("dismissed_team_notif");
      const teamNotif = (newTeam && newTeam.id !== dismissedTeamId) ? 1 : 0;
      setPendingChallenges((count ?? 0) + teamNotif);
    }
    checkChallenges();
    const interval = setInterval(checkChallenges, 30000);
    if (user && profile?.role === "player") {
      (async () => {
        const [xp, perks] = await Promise.all([getPlayerXp(user.id), getXpPerks()]);
        setPlayerXp(xp); setXpPerks(perks);
        const xpEnabledPerk = perks.find((p: any) => p.perk_key === "_xp_enabled");
        setXpEnabled(xpEnabledPerk?.xp_required !== 0);
        checkNewPerks();
      })();
    }
    return () => clearInterval(interval);
  }, [user, profile]);

  async function loadMyScores() {
    if (!user) return;
    setMyScores(await getMyScores(user.id));
    checkNewPerks();
  }
  async function loadAllScores() { setAllScores(await getAllScores()); }
  function handleProfileUpdated(updates: Partial<Profile>) {
    setLocalProfile(prev => ({ ...(prev ?? profile!), ...updates }));
  }

  if (authState === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0c14", flexDirection: "column", gap: 16 }}>
        <img src="/logo.png" alt="Bombardiers" style={{ height: 80, objectFit: "contain", opacity: 0.8 }} />
        <div style={{ fontSize: 13, color: "#7a85a0" }}>Loading…</div>
      </div>
    );
  }
  if (authState === "invite") return <ChangePassword title="Welcome to Attleboro Winning Wall! 🦅" subtitle="Your account is ready. Please create your own personal password before continuing." onComplete={() => window.location.reload()} />;
  if (authState === "recovery") return <ChangePassword title="Reset Your Password" subtitle="Enter your new password below." onComplete={() => window.location.reload()} />;
  if (!user || !profile) return <LoginPage />;
  if (profile.must_change_password === true) return <ChangePassword title="Welcome to Attleboro Winning Wall! 🦅" subtitle="Your account was set up by a coach. Please create your own personal password before continuing." onComplete={() => window.location.reload()} />;

  if (profile.role === "pending_player" || profile.role === "pending_coach") {
    const isCoachRequest = profile.role === "pending_coach";
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0c14", flexDirection: "column", gap: 20, padding: 24 }}>
        <img src="/logo.png" alt="Winning Wall" style={{ height: 80, objectFit: "contain", opacity: 0.9 }} />
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 32 }}>⏳</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#f0c040", letterSpacing: 1, marginTop: 10 }}>Awaiting Approval</div>
          <div style={{ fontSize: 14, color: "#7a85a0", marginTop: 12, lineHeight: 1.7 }}>
            Your {isCoachRequest ? "coach" : "player"} account is pending approval{isCoachRequest ? " from an admin" : " from a coach or admin"}. You'll be able to log in once approved. Check back soon!
          </div>
          <button onClick={signOut} style={{ marginTop: 24, background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 24px", fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>Sign Out</button>
        </div>
      </div>
    );
  }

  const isPlayer = profile.role === "player";
  const isCoach  = profile.role === "coach";
  const isAdmin  = profile.role === "admin";
  const roleLabel      = isAdmin ? "👑 Admin" : isCoach ? "🏀 Coach" : "⚡ Player";
  const displayProfile = localProfile ?? profile;

  return (
    <div id="app-screen" className={`screen active${isPlayer ? " has-bottom-tabs" : ""}`}>
      {/* Header */}
      <div className="app-header">
        <img src="/logo.png" alt="Open menu" onClick={() => setSidebarOpen(o => !o)} style={{ height: 36, objectFit: "contain", flexShrink: 0, cursor: "pointer" }} />
        <div className="header-logo">Winning <span>Wall</span></div>
        <div className="header-role">{roleLabel}</div>
        <div className="header-user">{displayProfile.name}</div>
      </div>

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className="app-body">
        {/* Sidebar */}
        <div className={`sidebar${sidebarOpen ? "" : " sidebar-collapsed"}`}>
          {isPlayer && (
            <>
              <div className={`nav-item ${playerTab==="workouts"?"active":""}`} onClick={()=>{setPlayerTab("workouts");if(window.innerWidth<768)setSidebarOpen(false);}}><span className="nav-icon">🏋️</span> Workouts</div>
              <div className={`nav-item ${playerTab==="leaderboard"?"active":""}`} onClick={()=>{setPlayerTab("leaderboard");if(window.innerWidth<768)setSidebarOpen(false);}}><span className="nav-icon">🏆</span> Leaderboard</div>
              <div className={`nav-item ${playerTab==="lifting"?"active":""}`} onClick={()=>{setPlayerTab("lifting");if(window.innerWidth<768)setSidebarOpen(false);}}><span className="nav-icon">💪</span> Lifting</div>
              <div className={`nav-item ${playerTab==="progress"?"active":""}`} onClick={()=>{setPlayerTab("progress");if(window.innerWidth<768)setSidebarOpen(false);}}><span className="nav-icon">📈</span> My Progress</div>
              <div className={`nav-item ${playerTab==="hof"?"active":""}`} onClick={()=>{setPlayerTab("hof");if(window.innerWidth<768)setSidebarOpen(false);}}><span className="nav-icon">👑</span> Hall of Fame</div>
              <div className={`nav-item ${playerTab==="profile"?"active":""}`} onClick={()=>{ setPlayerTab("profile"); setNewPerkCount(0); if(window.innerWidth<768)setSidebarOpen(false); }}><span className="nav-icon">👤</span> My Profile</div>
              <div className={`nav-item ${playerTab==="h2h"?"active":""}`} onClick={()=>{ setPlayerTab("h2h"); setPendingChallenges(0); if(window.innerWidth<768)setSidebarOpen(false); }} style={{ position: "relative" }}>
                <span className="nav-icon">⚔️</span> Challenges
                {pendingChallenges > 0 && <span style={{ position: "absolute", top: 6, right: 8, background: "#e53935", color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>{pendingChallenges}</span>}
              </div>
              <div style={{ height: 1, background: "var(--border)", margin: "8px 4px" }} />
              <div className="nav-item" onClick={signOut} style={{ color: "var(--muted)" }}><span className="nav-icon">🚪</span> Sign Out</div>
            </>
          )}
          {isCoach && (
            <>
              {coachNavOrder.map(key => {
                const item = COACH_NAV_CONFIG.find(i => i.key === key);
                if (!item) return null;
                return (
                  <div key={key} className={`nav-item ${coachTab===key?"active":""}`}
                    onClick={()=>{ setCoachTab(key as CoachTab); if (key==="players") setPendingApprovals(0); if(window.innerWidth<768)setSidebarOpen(false); }}>
                    <span className="nav-icon">{item.icon}</span> {item.label}
                    {key === "players" && pendingApprovals > 0 && <span style={{ marginLeft: 6, background: "#ff3c3c", color: "#fff", borderRadius: "50%", width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>{pendingApprovals}</span>}
                  </div>
                );
              })}
              <div className="nav-item" onClick={() => setShowReorderModal(true)} style={{ color: "var(--muted)" }}><span className="nav-icon">🔀</span> Reorder Menu</div>
              <div style={{ height: 1, background: "var(--border)", margin: "8px 4px" }} />
              <div className="nav-item" onClick={signOut} style={{ color: "var(--muted)" }}><span className="nav-icon">🚪</span> Sign Out</div>
            </>
          )}
          {isAdmin && (
            <>
              {adminNavOrder.map(key => {
                const item = ADMIN_NAV_CONFIG.find(i => i.key === key);
                if (!item) return null;
                return (
                  <div key={key} className={`nav-item ${adminTab===key?"active":""}`}
                    onClick={()=>{ setAdminTab(key as AdminTab); if (key==="players") setPendingApprovals(0); if(window.innerWidth<768)setSidebarOpen(false); }}>
                    <span className="nav-icon">{item.icon}</span> {item.label}
                    {key === "players" && pendingApprovals > 0 && <span style={{ marginLeft: 6, background: "#ff3c3c", color: "#fff", borderRadius: "50%", width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>{pendingApprovals}</span>}
                  </div>
                );
              })}
              <div className="nav-item" onClick={() => setShowReorderModal(true)} style={{ color: "var(--muted)" }}><span className="nav-icon">🔀</span> Reorder Menu</div>
              <div style={{ height: 1, background: "var(--border)", margin: "8px 4px" }} />
              <div className="nav-item" onClick={signOut} style={{ color: "var(--muted)" }}><span className="nav-icon">🚪</span> Sign Out</div>
            </>
          )}
        </div>

        {/* Main Content */}
        <div className="main-content"
          onTouchStart={isPlayer ? handleSwipeStart : undefined}
          onTouchMove={isPlayer ? handleSwipeMove : undefined}
          onTouchEnd={isPlayer ? handleSwipeEnd : undefined}
        >
          {isPlayer && (pullDistance > 0 || refreshing) && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: refreshing ? 48 : pullDistance, transition: refreshing ? "none" : "height 0.1s", overflow: "hidden", color: "var(--muted)", fontSize: 13, gap: 8 }}>
              {refreshing ? <><span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>🔄</span> Refreshing…</> : pullDistance > 40 ? "↑ Release to refresh" : "↓ Pull to refresh"}
            </div>
          )}

          {(isPlayer || isCoach || isAdmin) && <NotificationOptIn playerId={user.id} />}


          {/* Player panels */}
          {isPlayer && playerTab === "workouts" && <WorkoutsPanel workouts={workouts} myScores={myScores} playerId={user.id} onScoreLogged={loadMyScores} />}
          {isPlayer && playerTab === "leaderboard" && <Leaderboard currentUserId={user.id} />}
          {isPlayer && playerTab === "lifting" && <LiftingPanel playerId={user.id} playerName={displayProfile.name} avatarUrl={displayProfile.avatar_url} />}
          {isPlayer && playerTab === "progress" && <ProgressPanel profile={displayProfile} myScores={myScores} workouts={workouts} />}
          {isPlayer && playerTab === "hof" && <HallOfFame />}
          {isPlayer && playerTab === "profile" && <ProfilePage profile={displayProfile} onUpdated={handleProfileUpdated} myScores={allScores.filter((s: any) => s.player_id === user?.id)} workouts={workouts} xpEnabled={xpEnabled} />}
          {isPlayer && playerTab === "h2h" && xpEnabled && xpPerks.length > 0 && playerXp < (xpPerks.find((p: any) => p.perk_key === "challenges_unlocked")?.xp_required ?? 150) ? (
            <div className="panel active" style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--muted)", letterSpacing: 1, marginBottom: 12 }}>Challenges Locked</div>
              <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7 }}>
                Earn <strong style={{ color: "var(--gold)" }}>{(xpPerks.find((p: any) => p.perk_key === "challenges_unlocked")?.xp_required ?? 150) - playerXp} more XP</strong> to unlock head-to-head challenges.<br/>Log workouts to earn XP!
              </div>
            </div>
          ) : isPlayer && playerTab === "h2h" && (
            <ChallengesPanel
              currentUserId={user.id}
              currentUserName={displayProfile.name}
              workouts={workouts}
              myScores={myScores}
              onScoreLogged={loadMyScores}
              canManage={false}
            />
          )}
          {isPlayer && playerTab === "more" && (
            <div className="panel active">
              <div className="section-title">More</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <div onClick={() => setPlayerTab("progress")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "var(--surface2)", borderRadius: 12, cursor: "pointer", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 20 }}>📈</span><span style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>My Progress</span></div>
                  <span style={{ color: "var(--muted)" }}>›</span>
                </div>
                <div onClick={() => setPlayerTab("hof")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "var(--surface2)", borderRadius: 12, cursor: "pointer", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 20 }}>👑</span><span style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>Hall of Fame</span></div>
                  <span style={{ color: "var(--muted)" }}>›</span>
                </div>
                <div onClick={() => { setPlayerTab("profile"); setNewPerkCount(0); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "var(--surface2)", borderRadius: 12, cursor: "pointer", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 20 }}>👤</span><span style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>My Profile</span></div>
                  <span style={{ color: "var(--muted)" }}>›</span>
                </div>
                <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                <div onClick={signOut} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "var(--surface2)", borderRadius: 12, cursor: "pointer", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 20 }}>🚪</span><span style={{ fontSize: 14, color: "#ff7b7b", fontWeight: 500 }}>Sign Out</span></div>
                  <span style={{ color: "var(--muted)" }}>›</span>
                </div>
              </div>
            </div>
          )}

          {/* Coach panels */}
          {isCoach && coachTab === "workouts" && <CoachPanel workouts={workouts} onPublished={refreshWorkouts} coachId={user.id} coachName={displayProfile.name} isAdmin={false} />}
          {isCoach && coachTab === "leaderboard" && (<><Leaderboard canManage={true} /><ChampionsPanel /></>)}
          {isCoach && coachTab === "announcements" && (<><AnnouncementPanel isAdmin={false} coachId={user.id} coachName={displayProfile.name} /><SendNotificationPanel /></>)}
          {isCoach && coachTab === "lifting" && <LiftingPanel playerId={user.id} playerName={displayProfile.name} avatarUrl={displayProfile.avatar_url} isCoach={true} />}
          {isCoach && coachTab === "hof" && <HallOfFame canDelete={true} />}
          {isCoach && coachTab === "challenges" && (
            <ChallengesPanel currentUserId={user.id} currentUserName={displayProfile.name} workouts={workouts} myScores={myScores} onScoreLogged={loadMyScores} canManage={true} />
          )}
          {isCoach && coachTab === "players" && <PlayersPanel allScores={allScores} workouts={workouts} />}
          {isCoach && coachTab === "profile" && (
            <div className="panel active">
              <div className="section-title">My Profile</div>
              <div className="section-sub" style={{ marginBottom: 20 }}>Update your name and profile picture</div>
              <ProfileEditor profile={displayProfile} onUpdated={handleProfileUpdated} />
            </div>
          )}

          {/* Admin panels */}
          {isAdmin && adminTab === "workouts" && <CoachPanel workouts={workouts} onPublished={refreshWorkouts} coachId={user.id} coachName={displayProfile.name} isAdmin={true} />}
          {isAdmin && adminTab === "leaderboard" && (<><Leaderboard canManage={true} /><ChampionsPanel /></>)}
          {isAdmin && adminTab === "announcements" && (<><AnnouncementPanel isAdmin={true} coachId={user.id} coachName={displayProfile.name} /><SendNotificationPanel /></>)}
          {isAdmin && adminTab === "lifting" && <LiftingPanel playerId={user.id} playerName={displayProfile.name} avatarUrl={displayProfile.avatar_url} isAdmin={true} />}
          {isAdmin && adminTab === "hof" && <HallOfFame canDelete={true} />}
          {isAdmin && adminTab === "challenges" && (
            <ChallengesPanel currentUserId={user.id} currentUserName={displayProfile.name} workouts={workouts} myScores={myScores} onScoreLogged={loadMyScores} canManage={true} />
          )}
          {isAdmin && adminTab === "players" && <PlayersPanel allScores={allScores} workouts={workouts} />}
          {isAdmin && adminTab === "admin" && <AdminPanel />}
          {isAdmin && adminTab === "settings" && (
            <div className="panel active">
              <div className="section-title">Settings</div>
              <div className="section-sub" style={{ marginBottom: 20 }}>Configure your Winning Wall platform</div>
              <AdminSettings />
            </div>
          )}
          {isAdmin && adminTab === "profile" && (
            <div className="panel active">
              <div className="section-title">My Profile</div>
              <div className="section-sub" style={{ marginBottom: 20 }}>Update your name and profile picture</div>
              <ProfileEditor profile={displayProfile} onUpdated={handleProfileUpdated} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Tab Bar */}
      {isPlayer && (
        <nav className="bottom-tab-bar" aria-label="Main navigation">
          <button className={`bottom-tab${playerTab === "workouts" ? " active" : ""}`} onClick={() => setPlayerTab("workouts")}>
            <svg className="bottom-tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M4.93 4.93c4.25 4.25 4.25 9.9 0 14.14"/><path d="M19.07 4.93c-4.25 4.25-4.25 9.9 0 14.14"/><line x1="2" y1="12" x2="22" y2="12"/>
            </svg>
            <span>Workouts</span>
          </button>
          <button className={`bottom-tab${playerTab === "leaderboard" ? " active" : ""}`} onClick={() => setPlayerTab("leaderboard")}>
            <svg className="bottom-tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 22v-4"/><path d="M14 22v-4"/><path d="M6 4h12v9a6 6 0 01-12 0V4z"/>
            </svg>
            <span>Leaderboard</span>
          </button>
          <button className={`bottom-tab${playerTab === "h2h" ? " active" : ""}`} onClick={() => { setPlayerTab("h2h"); setPendingChallenges(0); }} style={{ position: "relative" }}>
            <svg className="bottom-tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z"/><path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/><path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z"/><path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z"/><path d="M14 14.5V19a2 2 0 01-2 2H6a2 2 0 01-2-2v-5"/><path d="M10 9.5V5a2 2 0 012-2h6a2 2 0 012 2v5"/>
            </svg>
            <span>Challenges</span>
            {pendingChallenges > 0 && <span className="tab-badge">{pendingChallenges}</span>}
          </button>
          <button className={`bottom-tab${playerTab === "lifting" ? " active" : ""}`} onClick={() => setPlayerTab("lifting")}>
            <svg className="bottom-tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.5 6.5h11"/><path d="M6.5 17.5h11"/><path d="M3 9.5v5"/><path d="M21 9.5v5"/><path d="M2 11h2"/><path d="M20 11h2"/><rect x="5" y="8" width="14" height="8" rx="1"/>
            </svg>
            <span>Lifting</span>
          </button>
          <button className={`bottom-tab${["hof","profile","progress","more"].includes(playerTab) ? " active" : ""}`} onClick={() => { setPlayerTab("more"); setNewPerkCount(0); }} style={{ position: "relative" }}>
            <svg className="bottom-tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            <span>More</span>
            {newPerkCount > 0 && <span className="tab-badge">{newPerkCount}</span>}
          </button>
        </nav>
      )}

      {isPlayer && perkToast && (
        <div className="toast show" style={{ background: "rgba(26,63,168,0.95)", border: "1px solid rgba(147,180,255,0.4)", color: "#93b4ff", fontWeight: 600 }}>
          {perkToast}
        </div>
      )}

      {isPlayer && user && (
        <PerkTutorial playerId={user.id} currentXp={playerXp} perks={xpPerks} onTutorialSeen={() => checkNewPerks()} />
      )}

      {showReorderModal && (isCoach || isAdmin) && user && (
        <NavReorderModal
          userId={user.id}
          items={(isAdmin ? adminNavOrder : coachNavOrder).map(k => (isAdmin ? ADMIN_NAV_CONFIG : COACH_NAV_CONFIG).find(i => i.key === k)!).filter(Boolean)}
          onSaved={(newOrder) => { if (isAdmin) setAdminNavOrder(newOrder); else setCoachNavOrder(newOrder); }}
          onClose={() => setShowReorderModal(false)}
        />
      )}

      <InstallPrompt />
    </div>
  );
}
