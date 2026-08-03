// src/components/game-stats/PracticeSuggestionsPanel.tsx
import { SuggestionItem, PracticeSuggestions } from "../../lib/practiceSuggestions";

interface Props {
  suggestions: PracticeSuggestions;
  canManage: boolean;
}

function Card({ item, showNote }: { item: SuggestionItem; showNote: boolean }) {
  const pct = Math.round(Math.abs(item.ratio - 1) * 100);
  return (
    <div style={{ background: "var(--surface2)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
        <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{item.side === "offense" ? "Offense" : "Defense"}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
        {item.raw ?? item.value} vs. goal {item.goal} — {pct}% {item.ratio < 1 ? "under" : "over"}
        {item.streak > 1 && <span style={{ color: "#ff9b9b" }}> · {item.streak} reports in a row</span>}
      </div>
      {showNote && item.note && (
        <div style={{ fontSize: 12, color: "var(--text)", marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
          💡 {item.note}
        </div>
      )}
    </div>
  );
}

export default function PracticeSuggestionsPanel({ suggestions, canManage }: Props) {
  const { weaknesses, strengths } = suggestions;
  if (!weaknesses.length && !strengths.length) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Practice Focus</div>

      {weaknesses.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#ff9b9b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Areas to work on</div>
          {weaknesses.map(w => <Card key={`${w.team}:${w.stat_key}`} item={w} showNote={canManage} />)}
        </div>
      )}

      {strengths.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "#a3d060", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Doing well</div>
          {strengths.map(s => <Card key={`${s.team}:${s.stat_key}`} item={s} showNote={false} />)}
        </div>
      )}
    </div>
  );
}
