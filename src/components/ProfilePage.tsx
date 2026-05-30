// src/components/ProfilePage.tsx
import { useState, useEffect } from "react";
import { supabase, Profile, getXpPerks, getPlayerXp, getPlayerTier, XpPerk,
         hasPerkUsedThisPeriod, usePerk, currentPeriodStart } from "../lib/supabase";
import { getActiveBadges, checkBadge, Badge, PlayerStats } from "../lib/badges";
import ProfileEditor from "./ProfileEditor";

interface Props {
  profile: Profile;
  onUpdated: () => void;
  myScores: any[];
  workouts: any[];
}

const TIER_NAMES = ["Rookie", "Challenger", "Varsity", "Elite", "Legend"];

export default function ProfilePage({ profile, onUpdated, myScores, workouts }: Props) {
  const [xp, setXp]             = useState(0);
  const [perks, setPerks]       = useState<XpPerk[]>([]);
  const [allBadges, setAllBadges] = useState<Badge[]>([]);
  const [champCount, setChampCount] = useState(0);
  const [challengesWon, setChallengesWon] = useState(0);
  const [streakShieldUsed, setStreakShieldUsed] = useState(false);
  const [scoreBoostUsed, setScoreBoostUsed]   = useState(false);
  const [usingShield, setUsingShield]         = useState(false);
  const [usingBoost, setUsingBoost]           = useState(false);
  const [toast, setToast]       = useState("");

  useEffect(() => { loadAll(); }, [profile.id]);

  async function loadAll() {
    const [xpVal, perksVal, badges, champ, chalWon, shieldUsed, boostUsed] = await Promise.all([
      getPlayerXp(profile.id),
      getXpPerks(),
      getActiveBadges(),
      supabase.from("biweekly_champions").select("id", { count: "exact", head: true }).eq("player_id", profile.id),
      supabase.from("challenges").select("id", { count: "exact", head: true }).eq("winner_id", profile.id).eq("status", "completed"),
      hasPerkUsedThisPeriod(profile.id, "streak_shield"),
      hasPerkUsedThisPeriod(profile.id, "score_boost"),
    ]);
    setXp(xpVal);
    setPerks(perksVal);
    setAllBadges(badges);
    setChampCount(champ.count ?? 0);
    setChallengesWon(chalWon.count ?? 0);
    setStreakShieldUsed(shieldUsed);
    setScoreBoostUsed(boostUsed);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleUseStreakShield() {
    setUsingShield(true);
    const ok = await usePerk(profile.id, "streak_shield");
    if (ok) {
      // Extend streak by adding a fake entry for yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await supabase.from("streaks").upsert({
        player_id: profile.id,
        last_logged_date: yesterday.toISOString().split("T")[0],
      }, { onConflict: "player_id" });
      showToast("🛡️ Streak Shield used! Your streak is safe.");
      setStreakShieldUsed(true);
    } else {
      showToast("Already used this period.");
    }
    setUsingShield(false);
  }

  async function handleUseScoreBoost() {
    const drill = prompt("Which drill do you want to boost? Enter the drill name:");
    if (!drill) return;
    const workout = workouts.find((w: any) => w.title.toLowerCase().includes(drill.toLowerCase()));
    if (!workout) { showToast("Drill not found. Try again."); return; }
    setUsingBoost(true);
    const ok = await usePerk(profile.id, "score_boost");
    if (ok) {
      const existing = myScores.find((s: any) => s.workout_id === workout.id);
      if (existing) {
        await supabase.from("scores").update({
          self_points: (existing.self_points || 0) + 5,
          points: (existing.points || 0) + 5,
        }).eq("id", existing.id);
      }
      showToast(`⚡ +5 applied to ${workout.title}!`);
      setScoreBoostUsed(true);
    } else {
      showToast("Already used this period.");
    }
    setUsingBoost(false);
  }

  const { tier, perk: currentPerk, nextPerk, avatarOutline } = getPlayerTier(xp, perks);
  const tierName = TIER_NAMES[tier] ?? "Legend";
  const nextXp   = nextPerk?.xp_required ?? null;
  const xpToNext = nextXp ? nextXp - xp : 0;
  const xpPct    = nextXp ? Math.min(100, Math.round((xp / nextXp) * 100)) : 100;

  const totalPoints   = myScores.reduce((s: number, sc: any) => s + (sc.points ?? 0), 0);
  const activeWorkouts = workouts.filter((w: any) => w.is_active !== false);
  const stats: PlayerStats = {
    workoutsCompleted: myScores.length,
    totalPoints,
    currentStreak: 0,
    isGroupChampion: profile.is_period_champion ?? false,
    hasPerfectScore: false,
    challengesWon,
    teamWins: 0,
  };
  const earned    = allBadges.filter(b => checkBadge(b, stats));
  const notEarned = allBadges.filter(b => !checkBadge(b, stats));

  const initials = profile.name.split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase();

  return (
    <div className="panel active">
      <div className="section-title">My Profile</div>

      {toast && (
        <div style={{ padding: "10px 16px", background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", borderRadius: 10, fontSize: 13, color: "#5de098", fontWeight: 600, marginBottom: 16 }}>
          {toast}
        </div>
      )}

      {/* ── Profile Card ── */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", overflow: "hidden", border: `3px solid ${avatarOutline}`, background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt={profile.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--gold)" }}>{initials}</span>
          }
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>{profile.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{profile.grade_category}</div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
              background: tier === 0 ? "var(--surface)" :
                          tier === 1 ? "rgba(156,163,175,0.15)" :
                          tier === 2 ? "rgba(192,192,192,0.15)" :
                          tier === 3 ? "rgba(37,80,212,0.15)" : "rgba(240,192,64,0.15)",
              color: tier === 0 ? "var(--muted)" :
                     tier === 1 ? "#9ca3af" :
                     tier === 2 ? "#c0c0c0" :
                     tier === 3 ? "#2550d4" : "var(--gold)",
              border: `1px solid ${avatarOutline}`,
            }}>
              {tier === 0 ? "🏀 Rookie" : tier === 1 ? "⚔️ Challenger" : tier === 2 ? "🏆 Varsity" : tier === 3 ? "💎 Elite" : "👑 Legend"}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{xp} XP</span>
          </div>
        </div>
      </div>

      {/* ── XP Progress ── */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>XP Progress</div>
          {nextPerk ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{xpToNext} XP to {nextPerk.perk_name}</div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--gold)" }}>Max tier reached! 👑</div>
          )}
        </div>
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, height: 10, overflow: "hidden", marginBottom: 8 }}>
          <div style={{ height: "100%", borderRadius: 6, background: tier >= 4 ? "var(--gold)" : tier >= 3 ? "#2550d4" : tier >= 2 ? "#c0c0c0" : tier >= 1 ? "#9ca3af" : "var(--royal)", width: `${xpPct}%`, transition: "width 0.5s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          10 XP per workout attempt · 2 XP per challenge sent · 3 XP per challenge completed
        </div>
      </div>

      {/* ── Perks ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 12 }}>
          🎁 Perks
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {perks.map((p, i) => {
            const unlocked = xp >= p.xp_required;
            const isShield = p.perk_key === "streak_shield";
            const isBoost  = p.perk_key === "score_boost";
            const outlines = ["var(--border)", "#9ca3af", "#c0c0c0", "#2550d4", "#f0c040"];
            const borderColor = unlocked ? (outlines[i] ?? "var(--gold)") : "var(--border)";
            return (
              <div key={p.perk_key} style={{ background: unlocked ? "rgba(26,63,168,0.06)" : "var(--surface2)", border: `1px solid ${borderColor}`, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, opacity: unlocked ? 1 : 0.5 }}>
                <div style={{ fontSize: 24, flexShrink: 0 }}>
                  {i === 0 ? "⚔️" : i === 1 ? "🤝" : i === 2 ? "🛡️" : i === 3 ? "💪" : "⚡"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: unlocked ? "var(--text)" : "var(--muted)" }}>
                    {p.perk_name}
                    {unlocked && <span style={{ marginLeft: 8, fontSize: 10, color: "#5de098", background: "rgba(40,180,80,0.15)", padding: "1px 6px", borderRadius: 10 }}>UNLOCKED</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.description}</div>
                  {!unlocked && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{p.xp_required - xp} XP to unlock</div>}
                </div>
                {unlocked && isShield && (
                  <button onClick={handleUseStreakShield} disabled={streakShieldUsed || usingShield}
                    style={{ background: streakShieldUsed ? "var(--surface)" : "rgba(192,192,192,0.15)", color: streakShieldUsed ? "var(--muted)" : "#c0c0c0", border: "1px solid #c0c0c0", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: streakShieldUsed ? "default" : "pointer", whiteSpace: "nowrap" }}>
                    {streakShieldUsed ? "Used" : usingShield ? "…" : "Use"}
                  </button>
                )}
                {unlocked && isBoost && (
                  <button onClick={handleUseScoreBoost} disabled={scoreBoostUsed || usingBoost}
                    style={{ background: scoreBoostUsed ? "var(--surface)" : "rgba(240,192,64,0.15)", color: scoreBoostUsed ? "var(--muted)" : "var(--gold)", border: "1px solid var(--gold)", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: scoreBoostUsed ? "default" : "pointer", whiteSpace: "nowrap" }}>
                    {scoreBoostUsed ? "Used" : usingBoost ? "…" : "Use"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Badges ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 12 }}>
          🏅 Badges — {earned.length}/{allBadges.length}
        </div>
        {allBadges.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>No badges configured yet.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {[...earned, ...notEarned].map(b => {
              const isEarned = earned.includes(b);
              return (
                <div key={b.id ?? b.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: isEarned ? "rgba(240,192,64,0.1)" : "var(--surface2)", border: `1px solid ${isEarned ? "rgba(240,192,64,0.3)" : "var(--border)"}`, borderRadius: 10, opacity: isEarned ? 1 : 0.45 }}>
                  <span style={{ fontSize: 20 }}>{b.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: isEarned ? "var(--gold)" : "var(--muted)" }}>{b.name}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>{b.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Edit Profile ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 12 }}>
          ✏️ Edit Profile
        </div>
        <ProfileEditor profile={profile} onUpdated={onUpdated} />
      </div>

    </div>
  );
}
