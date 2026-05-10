// src/components/AdminPanel.tsx — Admin only: manage coaches + full oversight
import { useState, useEffect } from "react";
import { supabase, GRADE_CATEGORIES, GradeCategory, Profile } from "../lib/supabase";

export default function AdminPanel() {
  const [coaches, setCoaches]           = useState<Profile[]>([]);
  const [loading, setLoading]           = useState(true);

  // ── Add coach ──
  const [showAdd, setShowAdd]           = useState(false);
  const [addName, setAddName]           = useState("");
  const [addEmail, setAddEmail]         = useState("");
  const [addPass, setAddPass]           = useState("");
  const [addSaving, setAddSaving]       = useState(false);
  const [addError, setAddError]         = useState("");

  // ── Invite coach ──
  const [showInvite, setShowInvite]     = useState(false);
  const [inviteEmail, setInviteEmail]   = useState("");
  const [inviteRole, setInviteRole]     = useState<"coach" | "player">("coach");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg]       = useState("");

  // ── Edit coach ──
  const [editCoach, setEditCoach]       = useState<Profile | null>(null);
  const [editSaving, setEditSaving]     = useState(false);
  const [editError, setEditError]       = useState("");

  useEffect(() => { loadCoaches(); }, []);

  async function loadCoaches() {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("role", "coach")
      .order("name");
    setCoaches(data ?? []);
    setLoading(false);
  }

  async function addCoach() {
    if (!addName.trim() || !addEmail.trim() || !addPass.trim()) {
      setAddError("Please fill in name, email, and password."); return;
    }
    setAddSaving(true); setAddError("");
    try {
      const { error } = await supabase.auth.signUp({
        email: addEmail,
        password: addPass,
        options: { data: { name: addName, role: "coach" } },
      });
      if (error) throw error;
      setShowAdd(false); setAddName(""); setAddEmail(""); setAddPass("");
      await loadCoaches();
    } catch (e: any) { setAddError(e.message); }
    finally { setAddSaving(false); }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviteSending(true); setInviteMsg("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(inviteEmail, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setInviteMsg(`✓ Invite sent to ${inviteEmail}`);
      setInviteEmail("");
    } catch (e: any) { setInviteMsg("Error: " + e.message); }
    finally { setInviteSending(false); }
  }

  async function saveCoachEdit() {
    if (!editCoach) return;
    setEditSaving(true); setEditError("");
    try {
      const { error } = await supabase.from("profiles").update({
        name: editCoach.name,
        role: editCoach.role,
      }).eq("id", editCoach.id);
      if (error) throw error;
      setEditCoach(null);
      await loadCoaches();
    } catch (e: any) { setEditError(e.message); }
    finally { setEditSaving(false); }
  }

  async function removeCoach(id: string, name: string) {
    if (!window.confirm(`Remove coach "${name}"? Their account will remain but they will lose coach access.`)) return;
    await supabase.from("profiles").update({ role: "player" }).eq("id", id);
    await loadCoaches();
  }

  if (loading) return <div className="loading">Loading coaches…</div>;

  return (
    <div className="panel active">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div className="section-title">Admin Panel</div>
        <span style={{ background: "rgba(240,192,64,0.2)", color: "var(--gold)", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(240,192,64,0.3)" }}>ADMIN</span>
      </div>
      <div className="section-sub">Full control — manage coaches and staff accounts</div>

      {/* ── Action buttons ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => { setShowAdd(a => !a); setShowInvite(false); }} style={{
          background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10,
          padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>➕ Add Coach</button>
        <button onClick={() => { setShowInvite(a => !a); setShowAdd(false); }} style={{
          background: "var(--surface2)", color: "var(--silver-light)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>✉️ Invite by Email</button>
      </div>

      {/* ── Add Coach Form ── */}
      {showAdd && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Add Coach Manually</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Full Name</label>
                <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Coach Name"
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Email</label>
                <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="coach@email.com"
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Temporary Password</label>
                <input type="text" value={addPass} onChange={e => setAddPass(e.target.value)} placeholder="Min 6 characters"
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              </div>
            </div>
            {addError && <div className="error-msg">{addError}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={addCoach} disabled={addSaving} className="btn-primary" style={{ flex: 1 }}>
                {addSaving ? "Adding…" : "Add Coach"}
              </button>
              <button onClick={() => setShowAdd(false)} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Form ── */}
      {showInvite && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Invite by Email</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
            Send an invitation link to a coach or player. They'll receive an email to set up their account.
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as "coach" | "player")}
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
              <option value="coach">Coach</option>
              <option value="player">Player</option>
            </select>
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder="email@address.com"
              style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
            <button onClick={sendInvite} disabled={inviteSending} style={{
              background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8,
              padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}>{inviteSending ? "Sending…" : "Send Invite"}</button>
          </div>
          {inviteMsg && <div style={{ fontSize: 13, color: inviteMsg.startsWith("✓") ? "#5de098" : "#ff7b7b" }}>{inviteMsg}</div>}
        </div>
      )}

      {/* ── Stats ── */}
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Coaches</div><div className="stat-value blue">{coaches.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active Workouts</div><div className="stat-value gold">—</div></div>
        <div className="stat-card"><div className="stat-label">Platform</div><div className="stat-value" style={{ fontSize: 18, color: "#5de098" }}>LIVE</div></div>
      </div>

      {/* ── Coach Table ── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="player-table">
          <thead>
            <tr>
              <th>Coach</th>
              <th>Email</th>
              <th style={{ textAlign: "center" }}>Role</th>
              <th style={{ textAlign: "center" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {coaches.map(c => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>—</td>
                <td style={{ textAlign: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: "rgba(26,63,168,0.2)", color: "#93b4ff" }}>
                    {c.role === "admin" ? "👑 Admin" : "🏀 Coach"}
                  </span>
                </td>
                <td style={{ textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                    <button onClick={() => { setEditCoach(c); setEditError(""); }} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--silver-light)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit</button>
                    <button onClick={() => removeCoach(c.id, c.name)} style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
            {coaches.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 24, fontSize: 14 }}>No coaches yet. Add one above!</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Edit Coach Modal ── */}
      {editCoach && (
        <div className="modal-overlay open" onClick={() => setEditCoach(null)}>
          <div className="log-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditCoach(null)}>✕</button>
            <div className="modal-title">Edit Coach</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
                <input value={editCoach.name} onChange={e => setEditCoach({ ...editCoach, name: e.target.value })}
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Role</label>
                <select value={editCoach.role} onChange={e => setEditCoach({ ...editCoach, role: e.target.value as any })}
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }}>
                  <option value="coach">Coach</option>
                  <option value="admin">Admin</option>
                  <option value="player">Player</option>
                </select>
              </div>
              {editError && <div className="error-msg">{editError}</div>}
              <button className="btn-primary" onClick={saveCoachEdit} disabled={editSaving}>
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
