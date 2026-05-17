// src/App.tsx
import { useEffect, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useWorkouts } from "./hooks/useWorkouts";
import { getMyScores, getAllScores, signOut, Score } from "./lib/supabase";
import LoginPage from "./pages/LoginPage";
import WorkoutsPanel from "./components/WorkoutsPanel";
import CoachPanel from "./components/CoachPanel";
import Leaderboard from "./components/Leaderboard";
import ProgressPanel from "./components/ProgressPanel";
import PlayersPanel from "./components/PlayersPanel";
import AdminPanel from "./components/AdminPanel";
import AdminSettings from "./components/AdminSettings";
import InstallPrompt from "./components/InstallPrompt";
import ChangePassword from "./components/ChangePassword";

type PlayerTab = "workouts" | "leaderboard" | "progress";
type CoachTab  = "workouts" | "leaderboard" | "players";
type AdminTab  = "workouts" | "leaderboard" | "players" | "admin" | "settings";

export default function App() {
  const { user, profile, authState } = useAuth();
  const { workouts, refresh: refreshWorkouts } = useWorkouts();
  const [myScores, setMyScores]   = useState<Score[]>([]);
  const [allScores, setAllScores] = useState<Score[]>([]);
  const [playerTab, setPlayerTab] = useState<PlayerTab>("workouts");
  const [coachTab, setCoachTab]   = useState<CoachTab>("workouts");
  const [adminTab, setAdminTab]   = useState<AdminTab>("workouts");

  useEffect(() => {
    if (user && profile?.role === "player") loadMyScores();
    if (user && (profile?.role === "coach" || profile?.role === "admin")) loadAllScores();
  }, [user, profile]);

  async function loadMyScores() {
    if (!user) return;
    setMyScores(await getMyScores(user.id));
  }
  async function loadAllScores() {
    setAllScores(await getAllScores());
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

  if (profile.must_change_password) {
    return <ChangePassword title="Welcome to Attleboro Winning Wall! 🦅" subtitle="Your account was set up by a coach. Please create your own personal password before continuing." onComplete={() => window.location.reload()} />;
  }

  const isPlayer = profile.role === "player";
  const isCoach  = profile.role === "coach";
  const isAdmin  = profile.role === "admin";
  const roleLabel = isAdmin ? "👑 Admin" : isCoach ? "🏀 Coach" : "⚡ Player";

  return (
    <div id="app-screen" className="screen active">
      {/* Header */}
      <div className="app-header">
        <img src="/logo.png" alt="Bombardiers" style={{ height: 36, objectFit: "contain", flexShrink: 0 }} />
        <div className="header-logo">Winning <span>Wall</span></div>
        <div className="header-role">{roleLabel}</div>
        <div className="header-user">{profile.name}</div>
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
            </>
          )}
          {isCoach && (
            <>
              <div className={`nav-item ${coachTab==="workouts"?"active":""}`} onClick={()=>setCoachTab("workouts")}><span className="nav-icon">➕</span> Manage Workouts</div>
              <div className={`nav-item ${coachTab==="leaderboard"?"active":""}`} onClick={()=>setCoachTab("leaderboard")}><span className="nav-icon">🏆</span> Leaderboard</div>
              <div className={`nav-item ${coachTab==="players"?"active":""}`} onClick={()=>setCoachTab("players")}><span className="nav-icon">👥</span> Player Data</div>
            </>
          )}
          {isAdmin && (
            <>
              <div className={`nav-item ${adminTab==="workouts"?"active":""}`} onClick={()=>setAdminTab("workouts")}><span className="nav-icon">➕</span> Manage Workouts</div>
              <div className={`nav-item ${adminTab==="leaderboard"?"active":""}`} onClick={()=>setAdminTab("leaderboard")}><span className="nav-icon">🏆</span> Leaderboard</div>
              <div className={`nav-item ${adminTab==="players"?"active":""}`} onClick={()=>setAdminTab("players")}><span className="nav-icon">👥</span> Player Data</div>
              <div style={{ height: 1, background: "var(--border)", margin: "8px 4px" }} />
              <div className={`nav-item ${adminTab==="admin"?"active":""}`} onClick={()=>setAdminTab("admin")} style={{ color: adminTab==="admin" ? "var(--gold)" : undefined }}>
                <span className="nav-icon">👑</span> Admin
              </div>
              <div className={`nav-item ${adminTab==="settings"?"active":""}`} onClick={()=>setAdminTab("settings")} style={{ color: adminTab==="settings" ? "var(--gold)" : undefined }}>
                <span className="nav-icon">⚙️</span> Settings
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
            <ProgressPanel profile={profile} myScores={myScores} workouts={workouts} />
          )}
          {isCoach && coachTab === "workouts" && (
            <CoachPanel workouts={workouts} onPublished={refreshWorkouts} />
          )}
          {isCoach && coachTab === "leaderboard" && <Leaderboard />}
          {isCoach && coachTab === "players" && (
            <PlayersPanel allScores={allScores} workouts={workouts} />
          )}
          {isAdmin && adminTab === "workouts" && (
            <CoachPanel workouts={workouts} onPublished={refreshWorkouts} />
          )}
          {isAdmin && adminTab === "leaderboard" && <Leaderboard />}
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
        </div>
      </div>
      <InstallPrompt />
    </div>
  );
}
