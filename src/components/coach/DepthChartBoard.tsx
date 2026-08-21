// DepthChartBoard — the stacked whole-program depth chart.
//
// Lanes run down the page (Varsity / JV / Freshman), positions across
// (ball handler → big). Stacked rather than a tab per team so moving a
// kid from JV to varsity is a drag rather than a re-entry, and so the
// whole program is visible at once.
//
// Below the board sit two working areas: Unplaced (everyone drawn in but
// not yet positioned, like the Bench in the grouping editor) and Bubble
// (the kids to watch on day 2). Neither counts as making the team — the
// cut button keeps whoever is in a LANE and deletes the rest, which is
// why emptying the bubble and making the cut are the same action.
//
// One spot per player, enforced in the database by partial unique
// indexes. No ghost cards: a combo guard sits in the combo guard column.

import { useState } from "react";
import {
  BoardCard, TeamPlanLane, TeamPosition, SlotZone,
  moveSlot, reorderColumn, removeSlot, gradeColor, gradeFromGradYear, isAlumni,
  GRADE_COLORS, GRADE_LABELS,
} from "../../lib/teamDesigner";

interface Props {
  lanes: TeamPlanLane[];
  positions: TeamPosition[];
  cards: BoardCard[];
  hideGraduating: boolean;
  onChanged: () => void;
  onLinkCard: (card: BoardCard) => void;
}

export default function DepthChartBoard({ lanes, positions, cards, hideGraduating, onChanged, onLinkCard }: Props) {
  const [drag, setDrag] = useState<BoardCard | null>(null);

  // "Hide graduating" is a display toggle rather than a plan type — the
  // same board becomes next year's view without a separate mode.
  const visible = hideGraduating
    ? cards.filter(c => {
        const g = gradeFromGradYear(c.graduation_year);
        return g == null || g < 12;
      })
    : cards;

  const inCell = (laneId: string, positionId: string) =>
    visible.filter(c => c.zone === "lane" && c.lane_id === laneId && c.position_id === positionId)
      .sort((a, b) => a.rank - b.rank);

  const inZone = (zone: SlotZone) =>
    visible.filter(c => c.zone === zone).sort((a, b) => a.display_name.localeCompare(b.display_name));

  async function drop(zone: SlotZone, laneId?: string, positionId?: string) {
    if (!drag) return;
    const existing = zone === "lane" && laneId && positionId ? inCell(laneId, positionId) : [];
    await moveSlot(drag.id, { zone, lane_id: laneId, position_id: positionId, rank: existing.length });
    setDrag(null);
    onChanged();
  }

  /** Reorders within a column. Depth order is the whole point of a depth chart, so it has to be adjustable without a drag-to-index. */
  async function nudge(card: BoardCard, dir: -1 | 1) {
    const column = inCell(card.lane_id!, card.position_id!);
    const i = column.findIndex(c => c.id === card.id);
    const j = i + dir;
    if (j < 0 || j >= column.length) return;
    const reordered = [...column];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    await reorderColumn(reordered.map(c => c.id));
    onChanged();
  }

  function Card({ card, ranked }: { card: BoardCard; ranked?: number }) {
    const grade = gradeFromGradYear(card.graduation_year);
    const alum = isAlumni(card.graduation_year);
    return (
      <div
        draggable
        onDragStart={() => setDrag(card)}
        onDragEnd={() => setDrag(null)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "var(--surface2)",
          borderLeft: `4px solid ${gradeColor(card.graduation_year)}`,
          border: "1px solid var(--border)",
          borderRadius: 8, padding: "6px 8px", marginBottom: 4,
          cursor: "grab", fontSize: 13,
          opacity: alum ? 0.5 : 1,
        }}
      >
        {ranked != null && <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 12 }}>{ranked + 1}</span>}
        <span style={{ flex: 1 }}>{card.display_name}</span>
        {grade != null && grade >= 9 && grade <= 12 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: GRADE_COLORS[grade] }}>{GRADE_LABELS[grade]}</span>
        )}
        {/* A hollow dot means a name with no account behind it yet — the
            thing you'd click once that kid signs up. */}
        <button
          onClick={() => onLinkCard(card)}
          title={card.linked ? "Linked to an account" : "Not linked — click to link to a player"}
          style={{ border: "none", background: "none", cursor: "pointer", fontSize: 11, color: card.linked ? "#2f9e63" : "var(--muted)", padding: 0 }}
        >
          {card.linked ? "●" : "○"}
        </button>
        {card.zone === "lane" && (
          <>
            <button onClick={() => nudge(card, -1)} style={miniBtn} title="Move up">▲</button>
            <button onClick={() => nudge(card, 1)} style={miniBtn} title="Move down">▼</button>
          </>
        )}
        <button
          onClick={async () => { await removeSlot(card.id); onChanged(); }}
          style={{ ...miniBtn, color: "var(--muted)" }}
          title="Remove from this board"
        >✕</button>
      </div>
    );
  }

  function Zone({ zone, label, hint }: { zone: SlotZone; label: string; hint: string }) {
    const list = inZone(zone);
    return (
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={() => drop(zone)}
        style={{ flex: 1, border: "1px dashed var(--border)", borderRadius: 10, padding: 10, minHeight: 90 }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{label} ({list.length})</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>{hint}</div>
        {list.map(c => <Card key={c.id} card={c} />)}
      </div>
    );
  }

  if (!positions.length) {
    return <div style={{ fontSize: 13, color: "var(--muted)" }}>Add at least one position to start building.</div>;
  }

  return (
    <div>
      {/* Without a key, four stripe colours are decoration rather than
          information. */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
        {[9, 10, 11, 12].map(g => (
          <span key={g} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: GRADE_COLORS[g], display: "inline-block" }} />
            {GRADE_LABELS[g]}
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#6b7280", display: "inline-block" }} />
          no year set
        </span>
        {/* The dot was unexplained, so it read as decoration. */}
        <span style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
          <span style={{ color: "#2f9e63" }}>●</span> has an account
          <span style={{ marginLeft: 8 }}>○</span> name only — tap to link
        </span>
      </div>

      {/* Teams across the top, positions down the side. Three teams fit on
          screen; five positions don't -- so the axis that grows is the one
          that scrolls vertically with the page, and each team reads as a
          column you scan top to bottom, which is how a depth chart is
          talked about anyway. */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: lanes.length * 170 + 120 }}>
          <div style={{ display: "grid", gridTemplateColumns: `120px repeat(${lanes.length}, minmax(160px, 1fr))`, gap: 8, marginBottom: 6 }}>
            <div />
            {lanes.map(l => (
              <div key={l.id} style={{ fontSize: 13, fontWeight: 700, textAlign: "center" }}>{l.name}</div>
            ))}
          </div>

          {positions.map(pos => (
            <div key={pos.id} style={{ display: "grid", gridTemplateColumns: `120px repeat(${lanes.length}, minmax(160px, 1fr))`, gap: 8, marginBottom: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{pos.name}</div>
                {/* The whole point of colouring by grade: how many of each
                    class you have at this spot, across every team. */}
                <div style={{ display: "flex", gap: 5, marginTop: 3 }}>
                  {[9, 10, 11, 12].map(g => {
                    const n = visible.filter(c => c.zone === "lane" && c.position_id === pos.id && gradeFromGradYear(c.graduation_year) === g).length;
                    if (!n) return null;
                    return (
                      <span key={g} style={{ fontSize: 10, fontWeight: 700, color: GRADE_COLORS[g] }}>
                        {n}{GRADE_LABELS[g]}
                      </span>
                    );
                  })}
                </div>
              </div>
              {lanes.map(lane => {
                const column = inCell(lane.id, pos.id);
                return (
                  <div
                    key={lane.id}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => drop("lane", lane.id, pos.id)}
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 8, minHeight: 60 }}
                  >
                    {column.map((c, i) => <Card key={c.id} card={c} ranked={i} />)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <Zone zone="unplaced" label="Unplaced" hint="Drawn onto the board, not yet positioned." />
        <Zone zone="bubble" label="Bubble" hint="Worth a closer look on day 2 — does not count as making the team." />
      </div>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  border: "none", background: "none", cursor: "pointer",
  fontSize: 10, color: "var(--text)", padding: "0 2px",
};
