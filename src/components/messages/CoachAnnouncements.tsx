// src/components/messages/CoachAnnouncements.tsx
// A coach's Announcements page: the program's announcements, the staff
// inbox (migration 203: head coaches and assistants), and -- head coaches
// only -- the inbox with Winning Wall (migration 192). Families (SQL 222):
// approving parents, absences they report, and family links.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import AnnouncementPanel from "../coach/AnnouncementPanel";
import SendNotificationPanel from "../coach/SendNotificationPanel";
import StaffInbox from "./StaffInbox";
import FamiliesPanel from "./FamiliesPanel";
import { getStaffFamilies } from "../../lib/family";

interface Props {
  coachId: string;
  coachName: string;
  programId: string | null;
  unread: number;
  onMessagesRead: () => void;
  /** Assistants get announcements and the staff inbox, not Winning Wall messages. */
  isHeadCoach?: boolean;
  staffUnread?: number;
  onStaffRead?: () => void;
}

type Tab = "announcements" | "messages" | "families";

// A "parent waiting" or "absence reported" push opens ?tab=announcements&sub=families.
// Read once when the app loads, before the address is tidied.
let openFamilies = (() => {
  try { return new URLSearchParams(window.location.search).get("sub") === "families"; } catch { return false; }
})();

export default function CoachAnnouncements({ coachId, coachName, programId, unread, onMessagesRead, isHeadCoach = true, staffUnread = 0, onStaffRead }: Props) {
  // One Messages tab: staff conversations, plus Winning Wall ones for head
  // coaches. Opens there when something unread is waiting (e.g. from a push).
  const waiting = staffUnread + (isHeadCoach ? unread : 0);
  const [tab, setTab] = useState<Tab>(() => {
    if (openFamilies) { openFamilies = false; return "families"; }
    return waiting > 0 ? "messages" : "announcements";
  });
  const [familiesWaiting, setFamiliesWaiting] = useState(0);
  useEffect(() => {
    getStaffFamilies().then(f => setFamiliesWaiting(f.filter(x => x.status === "pending").length)).catch(() => {});
  }, [programId]);
  const [programName, setProgramName] = useState<string | null>(null);
  useEffect(() => {
    if (!programId) return;
    supabase.from("programs").select("name").eq("id", programId).single()
      .then(({ data }: any) => setProgramName(data?.name ?? null));
  }, [programId]);

  const tabBtn = (k: Tab, label: string, badge?: number) => (
    <button onClick={() => setTab(k)} aria-pressed={tab === k}
      style={{ padding: "10px 16px", borderRadius: 9, border: 0, background: tab === k ? "var(--royal)" : "transparent", color: tab === k ? "#fff" : "var(--muted-2)",
        fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
      {label}
      {!!badge && <span style={{ minWidth: 20, height: 20, padding: "0 5px", borderRadius: 10, background: "#ff3c3c", color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>}
    </button>
  );

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: "var(--surface)", borderRadius: 12, padding: 4, marginBottom: 16, alignSelf: "flex-start", width: "fit-content" }}>
        {tabBtn("announcements", "Announcements")}
        {tabBtn("messages", "Messages", waiting)}
        {tabBtn("families", "Families", familiesWaiting)}
      </div>
      {tab === "families" ? (
        <FamiliesPanel onWaitingChange={setFamiliesWaiting} />
      ) : tab === "announcements" ? (
        <><AnnouncementPanel isAdmin={isHeadCoach} coachId={coachId} coachName={coachName} /><SendNotificationPanel /></>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            {isHeadCoach
              ? `Your staff and Admin. Staff messages are between ${programName ?? "your program"}'s coaches; Admin messages (in gold) only head coaches see. Players never see any of it.`
              : `Between ${programName ?? "your program"}'s coaches only. Players never see these.`}
          </div>
          <StaffInbox myName={coachName}
            platform={isHeadCoach && programId && programName ? { programId, programName } : null}
            onActivity={() => { onStaffRead?.(); if (isHeadCoach) onMessagesRead(); }} />
        </div>
      )}
    </>
  );
}
