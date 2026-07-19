// src/components/RandomDrillModal.tsx
// "Random Drill" generator, launched from the Drill Library. Players and
// coaches/admins pick a category + tags, hit Generate, and get one random
// matching drill back. Players can log a score directly from the result
// (deep-links into the normal Workouts scoring modal, same as tapping a
// drill in the library); coaches/admins only get Reroll/Close since they
// don't log scores themselves.

import { useState, useMemo, useEffect } from "react";
import { Workout } from "../lib/supabase";
import { randomDrillPool, pickRandomDrill } from "../lib/randomDrill";
import { getCategories } from "../lib/categories";

interface Props {
  drills: Workout[];
  canManage: boolean;
  onClose: () => void;
  onLogScore?: (workoutId: string, filters: { category: string; tags: string[] }) => void;
}

function getYouTubeId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/\s]+)/);
  return match ? match[1] : null;
}

export default function RandomDrillModal({ drills, canManage, onClose, onLogScore }: Props) {
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("All");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [step, setStep] = useState<"filter" | "result">("filter");
  const [result, setResult] = useState<Workout | null>(null);
  const [noMatch, setNoMatch] = useState(false);

  useEffect(() => { getCategories().then(cs => setCategories(cs.map(c => c.name))); }, []);

  const active = useMemo(() => drills.filter(d => (d as any).library_archived !== true), [drills]);

  const availableTags = useMemo(() => [...new Set(
    active
      .filter(d => category === "All" || d.category === category)
      .flatMap(d => (d as any).tags ?? [])
  )].sort(), [active, category]);

  function generate() {
    const candidates = randomDrillPool(active, { category, tags: selectedTags });
    const pick = pickRandomDrill(candidates);
    if (!pick) { setNoMatch(true); setResult(null); return; }
    setNoMatch(false);
    setResult(pick);
    setStep("result");
  }

  function reroll() {
    const candidates = randomDrillPool(active, { category, tags: selectedTags });
    const pick = pickRandomDrill(candidates, result?.id);
    if (!pick) { setNoMatch(true); setResult(null); return; }
    setNoMatch(false);
    setResult(pick);
  }

  function toggleTag(t: string) {
    setSelectedTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, width: "min(420px, 96vw)", padding: 22 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--text)", letterSpacing: 1, marginBottom: 4 }}>🎲 Random Drill</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
          {step === "filter" ? "Pick a category and tags, or leave them open to pull from the whole library." : "Here's your drill."}
        </div>

        {step === "filter" && (
          <>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
              {(["All", ...categories]).map(c => (
                <button key={c} onClick={() => { setCategory(c); setSelectedTags([]); }}
                  style={{ padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: category === c ? "var(--royal)" : "var(--surface2)", color: category === c ? "#fff" : "var(--muted)" }}>
                  {c}
                </button>
              ))}
            </div>

            {availableTags.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
                {availableTags.map(t => (
                  <button key={t} onClick={() => toggleTag(t)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, background: selectedTags.includes(t) ? "var(--gold)" : "transparent", color: selectedTags.includes(t) ? "#1a1a1a" : "var(--muted)" }}>
                    🏷️ {t}
                  </button>
                ))}
              </div>
            )}

            {noMatch && (
              <div style={{ fontSize: 12, color: "#ff7b7b", marginBottom: 14, padding: "10px 12px", background: "rgba(255,60,60,0.08)", borderRadius: 8, border: "1px solid rgba(255,60,60,0.2)" }}>
                No drills match those filters — try loosening them up.
              </div>
            )}

            <button onClick={generate} style={{ width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
              🎲 Generate
            </button>
          </>
        )}

        {step === "result" && (
          <>
            {noMatch || !result ? (
              <div style={{ fontSize: 12, color: "#ff7b7b", marginBottom: 14, padding: "10px 12px", background: "rgba(255,60,60,0.08)", borderRadius: 8, border: "1px solid rgba(255,60,60,0.2)" }}>
                No drills match those filters anymore — try different ones.
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border)", marginBottom: 16 }}>
                <span style={{ fontSize: 22 }}>{result.emoji ?? "🏀"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{result.title}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{result.category}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {((result as any).tags ?? []).map((t: string) => (
                      <span key={t} style={{ fontSize: 10, color: "var(--gold)" }}>🏷️ {t}</span>
                    ))}
                  </div>
                </div>
                {getYouTubeId(result.video_url) && <span style={{ fontSize: 12, color: "var(--gold)" }}>📹</span>}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button onClick={reroll} style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                🔁 Reroll
              </button>
              {!canManage && result && (
                <button onClick={() => { onLogScore?.(result.id, { category, tags: selectedTags }); onClose(); }}
                  style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                  Log Score
                </button>
              )}
            </div>
            <button onClick={() => setStep("filter")} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "9px", color: "var(--muted)", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
              ← Change Filters
            </button>
          </>
        )}

        <button onClick={onClose} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "10px", color: "var(--muted)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}
