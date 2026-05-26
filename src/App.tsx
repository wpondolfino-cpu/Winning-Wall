import { useEffect, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useWorkouts } from "./hooks/useWorkouts";
import { getMyScores, getAllScores, signOut, Score, Profile } from "./lib/supabase";
import ProfileEditor from "./components/ProfileEditor";
import LoginPage from "./pages/LoginPage";
import WorkoutsPanel from "./components/WorkoutsPanel";
import CoachPanel from "./components/CoachPanel";
import Leaderboard from "./components/Leaderboard";
import HallOfFame from "./components/HallOfFame";
import ProgressPanel from "./components/ProgressPanel";
import PlayersPanel from "./components/PlayersPanel";
import AdminPanel from "./components/AdminPanel";
import AdminSettings from "./components/AdminSettings";
import InstallPrompt from "./components/InstallPrompt";
import ChangePassword from "./components/ChangePassword";
import HeadToHead from "./components/HeadToHead";

type PlayerTab = "workouts" | "leaderboard" | "progress" | "h2h" | "hof" | "profile";
type CoachTab  = "workouts" | "leaderboard" | "players" | "profile";
type AdminTab  = "workouts" | "leaderboard" | "players" | "admin" | "settings" | "profile";

export default function App() {
  const { user, profile, authState } = useAuth();
  const { workouts, refresh: refreshWorkouts } = useWorkouts();
  const [myScores, setMyScores]     = useState<Score[]>([]);
  const [allScores, setAllScores]   = useState<Score[]>([]);
  const [playerTab, setPlayerTab]   = useState<PlayerTab>("workouts");
  const [coachTab, setCoachTab]     = useState<CoachTab>("workouts");
  const [adminTab, setAdminTab]     = useState<AdminTab>("workouts");
  const [pendingChallenges, setPendingChallenges] = useState(0);
  const [localProfile, setLocalProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (user && profile?.role === "player") loadMyScores();
    if (user && (profile?.role === "coach" || profile?.role === "admin")) loadAllScores();
  }, [user, profile]);

  // Poll for unseen challenges every 30s
  useEffect(() => {
    if (!user || profile?.role !== "player") return;
    async function checkChallenges() {
      const { supabase: sb } = await import("./lib/supabase");
      const { count } = await sb
        .from("challenges")
        .select("id", { count: "exact", head: true })
        .eq("opponent_id", user!.id)
        .eq("status", "pending")
        .eq("opponent_seen", false);
      setPendingChallenges(count ?? 0);
    }
    checkChallenges();
    const interval = setInterval(checkChallenges, 30000);
    return () => clearInterval(interval);
  }, [user, profile]);

  async function loadMyScores() {
    if (!user) return;
    setMyScores(await getMyScores(user.id));
  }
  async function loadAllScores() {
    setAllScores(await getAllScores());
  }

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

  if (authState === "invite") {
    return <ChangePassword title="Welcome to Attleboro Winning Wall! 🦅" subtitle="Your account is ready. Please create your own personal password before continuing." onComplete={() => window.location.reload()} />;
  }

  if (authState === "recovery") {
    return <ChangePassword title="Reset Your Password" subtitle="Enter your new password below." onComplete={() => window.location.reload()} />;
  }

  if (!user || !profile) return <LoginPage />;

  // Only show change password screen for coach/admin-added accounts
  // Self-registered users pick their own password so must_change_password is never set for them
  if (profile.must_change_password === true) {
    return <ChangePassword title="Welcome to Attleboro Winning Wall! 🦅" subtitle="Your account was set up by a coach. Please create your own personal password before continuing." onComplete={() => window.location.reload()} />;
  }

  // Pending approval screen
  if (profile.role === "pending_player" || profile.role === "pending_coach") {
    const isCoachRequest = profile.role === "pending_coach";
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0c14", flexDirection: "column", gap: 20, padding: 24 }}>
        <img src="/logo.png" alt="Winning Wall" style={{ height: 80, objectFit: "contain", opacity: 0.9 }} />
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 32 }}>⏳</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#f0c040", letterSpacing: 1, marginTop: 10 }}>
            Awaiting Approval
          </div>
          <div style={{ fontSize: 14, color: "#7a85a0", marginTop: 12, lineHeight: 1.7 }}>
            Your {isCoachRequest ? "coach" : "player"} account is pending approval
            {isCoachRequest ? " from an admin" : " from a coach or admin"}.
            You'll be able to log in once approved. Check back soon!
          </div>
          <button onClick={signOut} style={{ marginTop: 24, background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 24px", fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>
            Sign Out
          </button>
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
    <div id="app-screen" className="screen active">
      {/* Header */}
      <div className="app-header">
        <img src="/logo.png" alt="Bombardiers" style={{ height: 36, objectFit: "contain", flexShrink: 0 }} />
        <div className="header-logo">Winning <span>Wall</span></div>
        <div className="header-role">{roleLabel}</div>
        <div className="header-user">{displayProfile.name}</div>
        <button className="btn-logout" onClick={signOut}>Sign Out</button>
      </div>

      <div className="app-body">
        {/* ── Sidebar ── */}
        <div className="sidebar">
          {isPlayer && (
            <>
              <div className={`nav-item ${playerTab==="workouts"?"active":""}`} onClick={()=>setPlayerTab("workouts")}><span className="nav-icon">🏋️</span> Workouts</div>
              <div className={`nav-item ${playerTab==="leaderboard"?"active":""}`} onClick={()=>setPlayerTab("leaderboard")}><span className="nav-icon">🏆</span> Leaderboard</div>
              <div className={`nav-item ${playerTab==="progress"?"active":""}`} onClick={()=>setPlayerTab("progress")}><span className="nav-icon">📈</span> My Progress</div>
              <div className={`nav-item ${playerTab==="hof"?"active":""}`} onClick={()=>setPlayerTab("hof")}><span className="nav-icon">👑</span> Hall of Fame</div>
              <div className={`nav-item ${playerTab==="profile"?"active":""}`} onClick={()=>setPlayerTab("profile")}><span className="nav-icon">👤</span> My Profile</div>
              <div className={`nav-item ${playerTab==="h2h"?"active":""}`} onClick={()=>{ setPlayerTab("h2h"); setPendingChallenges(0); }} style={{ position: "relative" }}>
                <span className="nav-icon">⚔️</span> Challenges
                {pendingChallenges > 0 && (
                  <span style={{ position: "absolute", top: 6, right: 8, background: "#e53935", color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                    {pendingChallenges}
                  </span>
                )}
              </div>
            </>
          )}
          {isCoach && (
            <>
              <div className={`nav-item ${coachTab==="workouts"?"active":""}`} onClick={()=>setCoachTab("workouts")}><span className="nav-icon">➕</span> Manage Workouts</div>
              <div className={`nav-item ${coachTab==="leaderboard"?"active":""}`} onClick={()=>setCoachTab("leaderboard")}><span className="nav-icon">🏆</span> Leaderboard</div>
              <div className={`nav-item ${coachTab==="players"?"active":""}`} onClick={()=>setCoachTab("players")}><span className="nav-icon">👥</span> Player Data</div>
              <div className={`nav-item ${coachTab==="hof"?"active":""}`} onClick={()=>setCoachTab("hof")}><span className="nav-icon">👑</span> Hall of Fame</div>
              <div className={`nav-item ${coachTab==="profile"?"active":""}`} onClick={()=>setCoachTab("profile")}><span className="nav-icon">👤</span> My Profile</div>
            </>
          )}
          {isAdmin && (
            <>
              <div className={`nav-item ${adminTab==="workouts"?"active":""}`} onClick={()=>setAdminTab("workouts")}><span className="nav-icon">➕</span> Manage Workouts</div>
              <div className={`nav-item ${adminTab==="leaderboard"?"active":""}`} onClick={()=>setAdminTab("leaderboard")}><span className="nav-icon">🏆</span> Leaderboard</div>
              <div className={`nav-item ${adminTab==="players"?"active":""}`} onClick={()=>setAdminTab("players")}><span className="nav-icon">👥</span> Player Data</div>
              <div style={{ height: 1, background: "var(--border)", margin: "8px 4px" }} />
              <div className={`nav-item ${adminTab==="hof"?"active":""}`} onClick={()=>setAdminTab("hof")} style={{ color: adminTab==="hof" ? "var(--gold)" : undefined }}><span className="nav-icon">👑</span> Hall of Fame</div>
              <div className={`nav-item ${adminTab==="admin"?"active":""}`} onClick={()=>setAdminTab("admin")} style={{ color: adminTab==="admin" ? "var(--gold)" : undefined }}>
                <span className="nav-icon">👑</span> Admin
              </div>
              <div className={`nav-item ${adminTab==="settings"?"active":""}`} onClick={()=>setAdminTab("settings")} style={{ color: adminTab==="settings" ? "var(--gold)" : undefined }}>
                <span className="nav-icon">⚙️</span> Settings
              </div>
              <div className={`nav-item ${adminTab==="profile"?"active":""}`} onClick={()=>setAdminTab("profile")} style={{ color: adminTab==="profile" ? "var(--gold)" : undefined }}>
                <span className="nav-icon">👤</span> My Profile
              </div>
            </>
          )}
        </div>

        {/* ── Main Content ── */}
        <div className="main-content">
          {isPlayer && playerTab === "workouts" && (
            <WorkoutsPanel workouts={workouts} myScores={myScores} playerId={user.id} onScoreLogged={loadMyScores} />
          )}
          {isPlayer && playerTab === "leaderboard" && <Leaderboard currentUserId={user.id} />}
          {isPlayer && playerTab === "progress" && (
            <ProgressPanel profile={displayProfile} myScores={myScores} workouts={workouts} />
          )}
          {isPlayer && playerTab === "profile" && (
            <div className="panel active">
              <div className="section-title">My Profile</div>
              <div className="section-sub" style={{ marginBottom: 20 }}>Update your name, photo and grade</div>
              <ProfileEditor profile={displayProfile} onUpdated={handleProfileUpdated} />
            </div>
          )}
          {isPlayer && playerTab === "hof" && <HallOfFame />}
          {isPlayer && playerTab === "h2h" && (
            <HeadToHead currentUserId={user.id} currentUserName={displayProfile.name} workouts={workouts} myScores={myScores} onScoreLogged={loadMyScores} />
          )}
          {isCoach && coachTab === "workouts" && (
            <CoachPanel workouts={workouts} onPublished={refreshWorkouts} />
          )}
          {isCoach && coachTab === "leaderboard" && <Leaderboard />}
          {isCoach && coachTab === "hof" && <HallOfFame />}
          {isCoach && coachTab === "players" && (
            <PlayersPanel allScores={allScores} workouts={workouts} />
          )}
          {isCoach && coachTab === "profile" && (
            <div className="panel active">
              <div className="section-title">My Profile</div>
              <div className="section-sub" style={{ marginBottom: 20 }}>Update your name and profile picture</div>
              <ProfileEditor profile={displayProfile} onUpdated={handleProfileUpdated} />
            </div>
          )}
          {isAdmin && adminTab === "workouts" && (
            <CoachPanel workouts={workouts} onPublished={refreshWorkouts} />
          )}
          {isAdmin && adminTab === "leaderboard" && <Leaderboard />}
          {isAdmin && adminTab === "hof" && <HallOfFame />}
          {isAdmin && adminTab === "players" && (
            <PlayersPanel allScores={allScores} workouts={workouts} />
          )}
          {isAdmin && adminTab === "admin" && (
            <AdminPanel allScores={allScores} workouts={workouts} />
          )}
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
      <InstallPrompt />
    </div>
  );
}
