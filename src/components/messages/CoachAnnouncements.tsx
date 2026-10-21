// src/components/messages/CoachAnnouncements.tsx
// A head coach's Announcements page: their program's announcements, plus
// their inbox with Winning Wall (migration 192) as a second tab.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import AnnouncementPanel from "../coach/AnnouncementPanel";
import SendNotificationPanel from "../coach/SendNotificationPanel";
import MessageInbox from "./MessageInbox";

interface Props {
  coachId: string;
  coachName: string;
  programId: string | null;
  unread: number;
  onMessagesRead: () => void;
}

export default function CoachAnnouncements({ coachId, coachName, programId, unread, onMessagesRead }: Props) {
  // Opens on Messages when something unread is waiting (e.g. from a push).
  const [tab, setTab] = useState<"announcements" | "messages">(unread > 0 ? "messages" : "announcements");
  const [programName, setProgramName] = useState<string | null>(null);
  useEffect(() => {
    if (!programId) return;
    supabase.from("programs").select("name").eq("id", programId).single()
      .then(({ data }: any) => setProgramName(data?.name ?? null));
  }, [programId]);

  const tabBtn = (k: "announcements" | "messages", label: string, badge?: number) => (
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
        {tabBtn("messages", "Messages with Winning Wall", unread)}
      </div>
      {tab === "announcements" ? (
        <><AnnouncementPanel isAdmin={true} coachId={coachId} coachName={coachName} /><SendNotificationPanel /></>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            Questions, problems or ideas. Only {programName ?? "your program"}'s head coaches and Winning Wall see these.
          </div>
          <MessageInbox asPlatform={false} myProgram={programId && programName ? { id: programId, name: programName } : null} onActivity={onMessagesRead} />
        </div>
      )}
    </>
  );
}
