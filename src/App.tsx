// src/App.tsx
import { useEffect, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useWorkouts } from "./hooks/useWorkouts";
import { getMyScores, getAllScores, signOut, Score, Profile } from "./lib/supabase";
import LoginPage from "./pages/LoginPage";
import WorkoutsPanel from "./components/WorkoutsPanel";
import CoachPanel from "./components/CoachPanel";
import Leaderboard from "./components/Leaderboard";
import ProgressPanel from "./components/ProgressPanel";
import PlayersPanel from "./components/PlayersPanel";

type PlayerTab = "workouts" | "leaderboard" | "progress";
type CoachTab  = "workouts" | "leaderboard" | "players";

export default function App() {
  const { user, profile, loading } = useAuth();
  const { workouts, refresh: refreshWorkouts } = useWorkouts();
  const [myScores, setMyScores] = useState<Score[]>([]);
  const [allScores, setAllScores] = useState<Score[]>([]);
  const [playerTab, setPlayerTab] = useState<PlayerTab>("workouts");
  const [coachTab, setCoachTab]   = useState<CoachTab>("workouts");

  useEffect(() => {
    if (user && profile?.role === "player") loadMyScores();
    if (user && profile?.role === "coach")  loadAllScores();
  }, [user, profile]);

  async function loadMyScores() {
    if (!user) return;
    const data = await getMyScores(user.id);
    setMyScores(data);
  }

  async function loadAllScores() {
    const data = await getAllScores();
    setAllScores(data);
  }

  if (loading) return <div className="full-center">Loading…</div>;
  if (!user || !profile) return <LoginPage />;

  const isPlayer = profile.role === "player";
  const isCoach  = profile.role === "coach";

  return (
    <div id="app-screen" className="screen active">
      {/* Header */}
      <div className="app-header">
        <div className="header-logo">AHS <span>Winning</span> Wall</div>
        <div className="header-role">{isCoach ? "🏀 Coach" : "⚡ Player"}</div>
        <div className="header-user">{profile.name}</div>
        <button className="btn-logout" onClick={signOut}>Sign Out</button>
      </div>

      <div className="app-body">
        {/* Sidebar */}
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
        </div>

        {/* Main content */}
        <div className="main-content">
          {isPlayer && playerTab === "workouts" && (
            <WorkoutsPanel
              workouts={workouts}
              myScores={myScores}
              playerId={user.id}
              onScoreLogged={loadMyScores}
            />
          )}
          {isPlayer && playerTab === "leaderboard" && (
            <Leaderboard currentUserId={user.id} />
          )}
          {isPlayer && playerTab === "progress" && (
            <ProgressPanel profile={profile} myScores={myScores} workouts={workouts} />
          )}

          {isCoach && coachTab === "workouts" && (
            <CoachPanel workouts={workouts} onPublished={refreshWorkouts} />
          )}
          {isCoach && coachTab === "leaderboard" && (
            <Leaderboard />
          )}
          {isCoach && coachTab === "players" && (
            <PlayersPanel allScores={allScores} workouts={workouts} />
          )}
        </div>
      </div>
    </div>
  );
}
