// src/components/NicknameField.tsx
// The nickname box, shared by the coach's Edit player / Edit coach forms
// and the player's own profile. Blank shows the automatic short form in
// gray ("Dan" for Daniel), which is what prints until someone types one.

import { autoNickname, nicknameProblem } from "../lib/nicknames";

interface Props {
  /** Their full name, for the automatic short form. */
  fullName: string;
  value: string;
  onChange: (v: string) => void;
  /** Coach view of a player: show the lock checkbox. */
  lock?: { value: boolean; onChange: (v: boolean) => void };
  /** Player view when a coach has locked it. */
  lockedByCoach?: boolean;
  label?: string;
}

export default function NicknameField({ fullName, value, onChange, lock, lockedByCoach, label = "Nickname (for practice plans)" }: Props) {
  const auto = autoNickname(fullName);
  const problem = nicknameProblem(value);
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={auto || "—"}
        maxLength={20}
        disabled={lockedByCoach}
        style={{
          width: "100%", background: lockedByCoach ? "var(--surface)" : "var(--surface2)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "9px 12px", color: lockedByCoach ? "var(--muted)" : "var(--text)",
          fontFamily: "inherit", fontSize: 14, boxSizing: "border-box",
        }}
      />
      <div style={{ fontSize: 11, color: problem ? "var(--danger-text)" : "var(--muted)", marginTop: 4, lineHeight: 1.4 }}>
        {problem
          ?? (lockedByCoach ? "Set by your coach. Ask them to change it."
            : value.trim() ? "Shows on practice plans instead of the first name."
            : auto && auto !== fullName.trim().split(/\s+/)[0]
              ? `Filled in automatically: ${auto}. Type to change it.`
              : "Blank uses the first name. Type one to change it.")}
      </div>
      {lock && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: "var(--text)", cursor: "pointer" }}>
          <input type="checkbox" checked={lock.value} onChange={e => lock.onChange(e.target.checked)} />
          Lock so the player can't change it
        </label>
      )}
    </div>
  );
}
