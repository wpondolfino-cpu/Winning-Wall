// src/components/PerkTutorial.tsx
// Fires once when a player unlocks a new perk.
// Tracks seen state in Supabase so it never shows again.

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface PerkTutorialData {
  key: string;
  icon: string;
  title: string;
  subtitle: string;
  body: string;
  cta: string;        // button label
  color: string;      // accent color
  bgColor: string;    // background tint
}

const PERK_TUTORIALS: Record<string, PerkTutorialData> = {
  challenges_unlocked: {
    key:      "challenges_unlocked",
    icon:     "⚔️",
    title:    "Challenges Unlocked!",
    subtitle: "You've grinded your way here",
    body:     "Head to the Challenges tab and pick any teammate to go head to head on a drill. You both log your score and whoever wins gets +1 point added to their leaderboard total. Your score is hidden from your opponent until they submit theirs — no cheating. You can rematch anyone as many times as you want.\n\nOne thing to know — if you get challenged and don't respond within 5 days, you automatically forfeit and your opponent gets the win. So don't sleep on your notifications.",
    cta:      "Let's Go ⚔️",
    color:    "#93b4ff",
    bgColor:  "rgba(26,63,168,0.12)",
  },
  team_eligible: {
    key:      "team_eligible",
    icon:     "👥",
    title:    "You're Team Eligible!",
    subtitle: "The grind is paying off",
    body:     "You're now eligible to be drafted onto a team when Coach starts a team competition. Teams are made up of players across all grades and the winning team earns bonus points added directly to everyone's leaderboard score.\n\nYour team's score is just the sum of everyone's leaderboard points — so every drill you log helps the whole team. Check the Teams tab under Challenges to see standings when a competition is live.",
    cta:      "Got It 👥",
    color:    "#9ca3af",
    bgColor:  "rgba(156,163,175,0.12)",
  },
  streak_shield: {
    key:      "streak_shield",
    icon:     "🛡️",
    title:    "Streak Shield Earned!",
    subtitle: "Your consistency paid off",
    body:     "If you miss a day and your streak is about to break, go to My Profile → XP & Perks and tap Use before the next day ends to freeze it. Your streak stays intact like you never missed.\n\nYou get one use per biweekly period so save it for when you really need it — don't waste it on a day you could have logged.",
    cta:      "Got It 🛡️",
    color:    "#c0c0c0",
    bgColor:  "rgba(192,192,192,0.12)",
  },
  team_bonus: {
    key:      "team_bonus",
    icon:     "⚡",
    title:    "Team Boost Unlocked!",
    subtitle: "You're carrying the team",
    body:     "Your hustle just made your whole team better. Any team you're on now starts every competition with +3 bonus points built in. Coaches can see who has this perk when they're building teams so staying active keeps you valuable.\n\nKeep your leaderboard score high — your points are your team's points.",
    cta:      "Let's Get It ⚡",
    color:    "#2550d4",
    bgColor:  "rgba(37,80,212,0.12)",
  },
  score_boost: {
    key:      "score_boost",
    icon:     "💪",
    title:    "Score Boost Unlocked!",
    subtitle: "The rarest perk on the app",
    body:     "Go to My Profile → XP & Perks, tap Use, and pick any competitive drill to add +5 to your raw score. Rankings update automatically so you could jump spots on the leaderboard.\n\nOne use per period and it doesn't carry over so don't forget to use it.",
    cta:      "Let's Get It 💪",
    color:    "#f0c040",
    bgColor:  "rgba(240,192,64,0.12)",
  },
};

interface Props {
  playerId: string;
  currentXp: number;
  perks: { perk_key: string; xp_required: number }[];
  onTutorialSeen?: () => void; // called after each tutorial is dismissed
}

export default function PerkTutorial({ playerId, currentXp, perks, onTutorialSeen }: Props) {
  const [queue, setQueue]       = useState<PerkTutorialData[]>([]);
  const [current, setCurrent]   = useState<PerkTutorialData | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [step, setStep]         = useState(0); // for body text pagination

  useEffect(() => {
    if (!playerId || perks.length === 0) return;
    checkForNewPerks();
  }, [playerId, currentXp, perks]);

  // Show next in queue whenever queue changes and nothing is showing
  useEffect(() => {
    if (!current && queue.length > 0) {
      setCurrent(queue[0]);
      setStep(0);
      setQueue(q => q.slice(1));
    }
  }, [queue, current]);

  async function checkForNewPerks() {
    // Load which tutorials this player has already seen
    const { data: seen } = await supabase
      .from("tutorials_seen")
      .select("tutorial_key")
      .eq("player_id", playerId);

    const seenKeys = new Set((seen ?? []).map((r: any) => r.tutorial_key));

    // Find perks the player has unlocked but hasn't seen the tutorial for
    const newlyUnlocked = perks
      .filter(p => {
        const tutorialExists = PERK_TUTORIALS[p.perk_key];
        const playerHasIt    = currentXp >= p.xp_required;
        const notSeenYet     = !seenKeys.has(p.perk_key);
        return tutorialExists && playerHasIt && notSeenYet;
      })
      // Sort by xp_required so they fire in unlock order
      .sort((a, b) => a.xp_required - b.xp_required)
      .map(p => PERK_TUTORIALS[p.perk_key]);

    if (newlyUnlocked.length > 0) {
      setQueue(newlyUnlocked);
    }
  }

  async function dismiss() {
    if (!current || dismissing) return;
    setDismissing(true);

    // Mark as seen in Supabase
    await supabase.from("tutorials_seen").upsert({
      player_id:    playerId,
      tutorial_key: current.key,
      seen_at:      new Date().toISOString(),
    }, { onConflict: "player_id,tutorial_key" });

    // Animate out
    setTimeout(() => {
      setCurrent(null);
      setDismissing(false);
      onTutorialSeen?.(); // notify App.tsx to recheck badge count
    }, 300);
  }

  if (!current) return null;

  // Split body into paragraphs for cleaner rendering
  const paragraphs = current.body.split("\n\n");

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: "fixed", inset: 0, zIndex: 2000,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(4px)",
          opacity: dismissing ? 0 : 1,
          transition: "opacity 0.3s ease",
        }}
      />

      {/* Modal */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 2001,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
        pointerEvents: "none",
      }}>
        <div style={{
          background: "var(--surface)",
          border: `1px solid ${current.color}40`,
          borderRadius: 20,
          width: "min(480px, 96vw)",
          overflow: "hidden",
          pointerEvents: "all",
          transform: dismissing ? "scale(0.95) translateY(10px)" : "scale(1) translateY(0)",
          opacity: dismissing ? 0 : 1,
          transition: "all 0.3s ease",
          boxShadow: `0 0 60px ${current.color}20`,
        }}>

          {/* Header banner */}
          <div style={{
            background: current.bgColor,
            borderBottom: `1px solid ${current.color}30`,
            padding: "28px 28px 24px",
            textAlign: "center",
          }}>
            {/* Animated icon */}
            <div style={{
              fontSize: 56,
              marginBottom: 12,
              display: "inline-block",
              animation: "perkBounce 0.6s ease",
            }}>
              {current.icon}
            </div>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 28,
              color: current.color,
              letterSpacing: 1,
              lineHeight: 1.1,
              marginBottom: 6,
            }}>
              {current.title}
            </div>
            <div style={{
              fontSize: 13,
              color: "var(--muted)",
              fontWeight: 500,
            }}>
              {current.subtitle}
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "24px 28px" }}>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              marginBottom: 24,
            }}>
              {paragraphs.map((para, i) => (
                <p key={i} style={{
                  fontSize: 14,
                  color: i === 0 ? "var(--text)" : "var(--muted)",
                  lineHeight: 1.7,
                  margin: 0,
                }}>
                  {para}
                </p>
              ))}
            </div>

            {/* Queue indicator — shows if multiple perks unlocked at once */}
            {queue.length > 0 && (
              <div style={{
                textAlign: "center",
                fontSize: 12,
                color: "var(--muted)",
                marginBottom: 16,
              }}>
                {queue.length} more perk{queue.length !== 1 ? "s" : ""} to unlock 🎁
              </div>
            )}

            {/* CTA button */}
            <button
              onClick={dismiss}
              style={{
                width: "100%",
                background: current.color,
                color: current.key === "team_eligible" ? "#111" : "#fff",
                border: "none",
                borderRadius: 12,
                padding: "14px",
                fontSize: 15,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              {current.cta}
            </button>

            {/* Skip text */}
            <div
              onClick={dismiss}
              style={{
                textAlign: "center",
                fontSize: 12,
                color: "var(--muted)",
                marginTop: 12,
                cursor: "pointer",
              }}
            >
              Tap anywhere to dismiss
            </div>
          </div>
        </div>
      </div>

      {/* Bounce animation */}
      <style>{`
        @keyframes perkBounce {
          0%   { transform: scale(0.5) rotate(-10deg); opacity: 0; }
          60%  { transform: scale(1.2) rotate(5deg);  opacity: 1; }
          80%  { transform: scale(0.95) rotate(-2deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
      `}</style>
    </>
  );
}
