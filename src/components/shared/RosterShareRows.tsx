// src/components/shared/RosterShareRows.tsx
//
// The team rows that sit above the list of names in a share or assign
// picker, so a coach can hand something to a whole roster in one tap
// instead of finding fourteen players.
//
// Lives here rather than in either picker because there are two of them —
// sharing a play and assigning a playbook — and the last time two screens
// implemented the same idea separately they drifted.
//
// Sharing with a roster writes one row per player. It is a snapshot, not
// a rule: someone called up next month doesn't inherit it. That's why the
// row reports "12 of 14" rather than a plain shared/not-shared, and why
// tapping a partly-shared team fills in only the gap.

import { useEffect, useState } from "react";
import { getRosterShareGroups, type RosterGroup } from "../../lib/plays";

export default function RosterShareRows({ sharedWithIds, onAdd, onRemove, busy }: {
  /** Profile ids this play/playbook is already shared with. */
  sharedWithIds: string[];
  /** Add everyone on the roster who isn't already covered. */
  onAdd: (memberIds: string[]) => void | Promise<void>;
  /** Remove the whole roster's members. */
  onRemove: (memberIds: string[]) => void | Promise<void>;
  busy?: boolean;
}) {
  const [groups, setGroups] = useState<RosterGroup[]>([]);

  useEffect(() => { getRosterShareGroups().then(setGroups).catch(console.error); }, []);

  if (!groups.length) return null;
  const shared = new Set(sharedWithIds);

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>Teams</div>
      {groups.map((g) => {
        const have = g.memberIds.filter((id) => shared.has(id)).length;
        const total = g.memberIds.length;
        const all = have === total;
        const missing = g.memberIds.filter((id) => !shared.has(id));
        return (
          <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", marginBottom: 4, border: "1px solid var(--border)", borderRadius: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>
              {g.name}
              <span style={{ fontSize: 11, color: all ? "#5de098" : "var(--muted)", marginLeft: 7 }}>
                {have === 0 ? `${total} player${total === 1 ? "" : "s"}` : all ? `all ${total} shared` : `${have} of ${total} shared`}
              </span>
            </span>
            {!all && (
              <button disabled={busy} onClick={() => onAdd(missing)}
                style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 600, border: "none", borderRadius: 6, padding: "5px 10px", background: "var(--royal)", color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>
                {have === 0 ? "Share with team" : `Add remaining ${missing.length}`}
              </button>
            )}
            {have > 0 && (
              <button disabled={busy} onClick={() => onRemove(g.memberIds.filter((id) => shared.has(id)))}
                style={{ flexShrink: 0, fontSize: 11.5, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 9px", background: "transparent", color: "var(--muted)", cursor: "pointer", fontFamily: "inherit" }}>
                Remove all
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
