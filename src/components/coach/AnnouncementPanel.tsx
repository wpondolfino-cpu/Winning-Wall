// src/components/coach/AnnouncementPanel.tsx
// Parent portal (SQL 222): each announcement goes to players, parents or
// both, and to every team or just the ones picked. Parents get their own
// push, and the coach sees "Seen by 12 of 20 parents".
import { useState, useEffect, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import { announcementParentStats, notifyParentAnnouncement, type Audience } from "../../lib/family";

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: "players", label: "🏀 Players" },
  { key: "parents", label: "👪 Parents" },
  { key: "both", label: "Both" },
];
const AUDIENCE_TAG: Record<string, string> = { parents: "👪 PARENTS ONLY", both: "👪 PLAYERS + PARENTS" };

interface Props {
  isAdmin: boolean;
  coachId: string | null;
  coachName: string;
}

export default function AnnouncementPanel({ isAdmin, coachId, coachName }: Props) {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [showForm, setShowForm]           = useState(false);
  const [newMsg, setNewMsg]               = useState("");
  const [isPinned, setIsPinned]           = useState(false);
  const [posting, setPosting]             = useState(false);
  // What happened to the push for the last post. functions.invoke doesn't
  // throw on a failed request, so failures used to vanish silently.
  const [pushStatus, setPushStatus]       = useState<string | null>(null);
  // Platform admin only: post one announcement into every program.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [everywhere, setEverywhere]           = useState(false);
  const [audience, setAudience]               = useState<Audience>("players");
  const [teamIds, setTeamIds]                 = useState<string[]>([]);
  const [teams, setTeams]                     = useState<{ id: string; name: string }[]>([]);
  const [stats, setStats]                     = useState<Record<string, { seen: number; total: number }>>({});

  useEffect(() => { load(); }, []);
  useEffect(() => {
    supabase.from("rosters").select("id, name, status").order("sort_order", { ascending: true })
      .then(({ data }: any) => setTeams(((data ?? []) as any[]).filter(r => r.status !== "archived").map(r => ({ id: r.id, name: r.name }))));
  }, []);
  useEffect(() => {
    if (!coachId) return;
    supabase.from("platform_admins").select("user_id").eq("user_id", coachId)
      .then(({ data }) => setIsPlatformAdmin((data ?? []).length > 0));
  }, [coachId]);

  async function load() {
    const { data } = await supabase.from("announcements").select("*")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false }).limit(20);
    setAnnouncements(data ?? []);
    const forParents = (data ?? []).filter((a: any) => a.audience === "parents" || a.audience === "both").map((a: any) => a.id);
    announcementParentStats(forParents).then(setStats).catch(() => setStats({}));
  }

  async function post() {
    if (!newMsg.trim()) return;
    setPosting(true);
    const toEveryProgram = everywhere && isPlatformAdmin;
    const aud: Audience = toEveryProgram ? "players" : audience;
    const rosterIds = toEveryProgram ? [] : teamIds;
    let newId: string | null = null;
    if (toEveryProgram) {
      const { error } = await supabase.rpc("post_announcement_everywhere", { p_message: newMsg.trim(), p_pinned: isPinned });
      if (error) { setPushStatus(`Not posted: ${error.message}`); setPosting(false); return; }
    } else {
      const { data: made, error } = await supabase.from("announcements").insert({
        coach_id: coachId, coach_name: coachName,
        message: newMsg.trim(), is_pinned: isPinned,
        audience: aud, roster_ids: rosterIds,
      }).select("id").single();
      if (error) { setPushStatus(`Not posted: ${error.message}`); setPosting(false); return; }
      newId = (made as any)?.id ?? null;
    }

    // Parents: their own push, checked against the announcement.
    let parentNote = "";
    if (newId && aud !== "players") {
      const r = await notifyParentAnnouncement(newId);
      parentNote = r.error ? " Parents weren't notified." : typeof r.recipients === "number" ? ` Parents: ${r.recipients} device${r.recipients === 1 ? "" : "s"}.` : " Parents notified.";
    }

    // Players (and staff), unless it's for parents only.
    // The announcement is posted either way; this reports on the push.
    if (aud === "parents") {
      setPushStatus(`Posted for parents.${parentNote}`);
    } else try {
      let target: Record<string, unknown> = toEveryProgram ? { allPrograms: true } : { allPlayers: true };
      if (!toEveryProgram && rosterIds.length) {
        const { data: kids } = await supabase.from("profiles").select("id").eq("role", "player").in("home_roster_id", rosterIds);
        target = { playerIds: ((kids ?? []) as any[]).map(k => k.id) };
      }
      const { data, error } = (target.playerIds as string[] | undefined)?.length === 0
        ? { data: { sent: false, reason: "no players on those teams" }, error: null }
        : await supabase.functions.invoke("send-push", {
        body: {
          title: isPinned ? "📌 New pinned announcement" : "📢 New announcement from Coach",
          message: newMsg.trim(),
          // Everyone in this program, the picked teams, or every program.
          ...target,
        },
      });
      if (error) {
        let detail = error.message;
        try { const b = await (error as any).context?.json?.(); if (b?.error) detail = b.error + (b.detail ? ` — ${JSON.stringify(b.detail)}` : ""); } catch { /* keep message */ }
        setPushStatus(`Posted, but the notification didn't send: ${detail}`);
      } else if ((data as any)?.sent === false) {
        setPushStatus(`Posted, but nobody was notified: ${(data as any).reason}`);
      } else {
        const recipients = (data as any)?.result?.recipients;
        const skipped = (data as any)?.skipped ?? 0;
        const off = skipped > 0 ? ` (${skipped} account${skipped === 1 ? " has" : "s have"} notifications off)` : "";
        setPushStatus((typeof recipients === "number" && recipients > 0
          ? `Posted and sent to ${recipients} device${recipients === 1 ? "" : "s"}`
          : "Posted and sent") + off + "." + parentNote);
      }
    } catch (e: any) {
      setPushStatus(`Posted, but the notification didn't send: ${e?.message ?? e}`);
    }

    setNewMsg(""); setIsPinned(false); setEverywhere(false); setAudience("players"); setTeamIds([]); setShowForm(false);
    await load();
    setPosting(false);
  }

  async function del(ann: any) {
    // A post to every program: the platform admin can take it down everywhere.
    if (ann.broadcast_id && isPlatformAdmin
        && window.confirm("This was posted to every program. Remove it from every program?\n\nOK = every program · Cancel = just this one")) {
      const { error } = await supabase.rpc("delete_announcement_everywhere", { p_broadcast_id: ann.broadcast_id });
      if (error) alert("Error: " + error.message);
      load();
      return;
    }
    await supabase.from("announcements").delete().eq("id", ann.id);
    load();
  }

  async function togglePin(ann: any) {
    await supabase.from("announcements").update({ is_pinned: !ann.is_pinned }).eq("id", ann.id);
    load();
  }

  const canEdit = (ann: any) => isAdmin || ann.coach_id === coachId;

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--info-text)", letterSpacing: 1 }}>📢 Announcements</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Post messages for players, parents, or both</div>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          style={{ background: showForm ? "var(--surface)" : "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          {showForm ? "✕ Cancel" : "+ Post"}
        </button>
      </div>
      {pushStatus && (
        <div style={{ fontSize: 12, marginBottom: 12, color: pushStatus.startsWith("Posted") && !/didn't|weren't|nobody/.test(pushStatus) ? "var(--success-text)" : "var(--tx-ff8c42)" }}>{pushStatus}</div>
      )}

      {showForm && (
        <div style={{ marginBottom: 16, padding: 14, background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
          <textarea value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Write your announcement here..." rows={3}
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
          {!(everywhere && isPlatformAdmin) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--muted)", width: 34 }}>For</span>
                {AUDIENCES.map(a => (
                  <button key={a.key} onClick={() => setAudience(a.key)} aria-pressed={audience === a.key} style={pillStyle(audience === a.key)}>{a.label}</button>
                ))}
              </div>
              {teams.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", width: 34 }}>Team</span>
                  <button onClick={() => setTeamIds([])} aria-pressed={teamIds.length === 0} style={pillStyle(teamIds.length === 0)}>All teams</button>
                  {teams.map(t => {
                    const on = teamIds.includes(t.id);
                    return <button key={t.id} aria-pressed={on} style={pillStyle(on)}
                      onClick={() => setTeamIds(ids => on ? ids.filter(x => x !== t.id) : [...ids, t.id])}>{t.name}</button>;
                  })}
                </div>
              )}
              {audience !== "players" && <div style={{ fontSize: 11, color: "var(--muted)" }}>Parents only see announcements marked for parents. {audience === "parents" ? "Players won't see this one." : ""}</div>}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} />
              📌 Pin to top
            </label>
            {isPlatformAdmin && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: everywhere ? "var(--gold-text)" : "var(--muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={everywhere} onChange={e => setEverywhere(e.target.checked)} />
                🌐 Post to every program
              </label>
            )}
            <button onClick={post} disabled={posting || !newMsg.trim()}
              style={{ marginLeft: "auto", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              {posting ? "Posting…" : everywhere && isPlatformAdmin ? "Post to Every Program" : "Post Announcement"}
            </button>
          </div>
        </div>
      )}

      {announcements.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>No announcements yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {announcements.map(ann => (
            <div key={ann.id} style={{ padding: "12px 14px", background: ann.is_pinned ? "rgba(240,192,64,0.08)" : "var(--surface)", borderRadius: 10, border: `1px solid ${ann.is_pinned ? "rgba(240,192,64,0.25)" : "var(--border)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  {ann.is_pinned && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--gold-text)", marginRight: 6 }}>📌 PINNED</span>}
                  {ann.broadcast_id && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--info-text)", marginRight: 6 }}>🌐 ALL PROGRAMS</span>}
                  {AUDIENCE_TAG[ann.audience] && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--success-text)", marginRight: 6 }}>{AUDIENCE_TAG[ann.audience]}</span>}
                  {(ann.roster_ids ?? []).length > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", marginRight: 6 }}>{(ann.roster_ids as string[]).map(id => teams.find(t => t.id === id)?.name ?? "Team").join(", ").toUpperCase()}</span>}
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{ann.message}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    {ann.coach_name} · {new Date(ann.created_at).toLocaleDateString()}
                    {stats[ann.id] && <> · 👀 Seen by {stats[ann.id].seen} of {stats[ann.id].total} parent{stats[ann.id].total === 1 ? "" : "s"}</>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {canEdit(ann) && <button onClick={() => togglePin(ann)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: ann.is_pinned ? "var(--gold-text)" : "var(--muted)" }}>📌</button>}
                  {canEdit(ann) && <button onClick={() => del(ann)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--danger-text)" }}>🗑</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function pillStyle(on: boolean): CSSProperties {
  return {
    padding: "5px 11px", borderRadius: 999, border: `1px solid ${on ? "var(--royal)" : "var(--border)"}`,
    background: on ? "var(--royal)" : "transparent", color: on ? "#fff" : "var(--muted-2)",
    fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
  };
}
