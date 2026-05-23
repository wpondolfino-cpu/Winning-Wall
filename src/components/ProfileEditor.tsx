// src/components/ProfileEditor.tsx
// Reusable profile editor — works for players, coaches, and admins
import { useState, useRef } from "react";
import { Profile, updateProfileName, uploadAvatar, GRADE_CATEGORIES, supabase } from "../lib/supabase";

interface Props {
  profile: Profile;
  onUpdated: (updated: Partial<Profile>) => void; // callback so parent can refresh
}

export default function ProfileEditor({ profile, onUpdated }: Props) {
  const [name, setName]           = useState(profile.name);
  const [saving, setSaving]       = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast]         = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatar_url ?? null);
  const [grade, setGrade]             = useState<string>(profile.grade_category ?? GRADE_CATEGORIES[0]);
  const [savingGrade, setSavingGrade] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleSaveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === profile.name) return;
    setSaving(true);
    try {
      await updateProfileName(profile.id, trimmed);
      onUpdated({ name: trimmed });
      showToast("✅ Name updated!");
    } catch (e: any) {
      showToast("Error: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveGrade() {
    if (grade === profile.grade_category) return;
    setSavingGrade(true);
    try {
      const { error } = await supabase.from("profiles").update({ grade_category: grade }).eq("id", profile.id);
      if (error) throw error;
      onUpdated({ grade_category: grade as any });
      showToast("✅ Grade updated!");
    } catch (e: any) {
      showToast("Error: " + e.message);
    } finally {
      setSavingGrade(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      showToast("❌ Image must be under 5MB");
      return;
    }

    // Show local preview immediately
    const localUrl = URL.createObjectURL(file);
    setAvatarPreview(localUrl);

    setUploading(true);
    try {
      const publicUrl = await uploadAvatar(profile.id, file);
      setAvatarPreview(publicUrl);
      onUpdated({ avatar_url: publicUrl });
      showToast("✅ Profile picture updated!");
    } catch (e: any) {
      setAvatarPreview(profile.avatar_url ?? null);
      showToast("Error uploading: " + e.message);
    } finally {
      setUploading(false);
    }
  }

  const initials = profile.name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const roleColor = profile.role === "admin" ? "var(--gold)" : profile.role === "coach" ? "#93b4ff" : "#5de098";
  const roleLabel = profile.role === "admin" ? "👑 Admin" : profile.role === "coach" ? "🏀 Coach" : "⚡ Player";

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-title">My Profile</div>

      {/* Avatar + role row */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 24 }}>
        {/* Avatar circle */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              width: 80, height: 80, borderRadius: "50%",
              background: avatarPreview ? "transparent" : "rgba(26,63,168,0.3)",
              border: "2px solid var(--royal)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", overflow: "hidden", position: "relative",
              transition: "opacity 0.2s",
            }}
          >
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt={profile.name}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--gold)", letterSpacing: 1 }}>
                {initials}
              </span>
            )}

            {/* Hover overlay */}
            <div style={{
              position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              opacity: uploading ? 1 : 0,
              transition: "opacity 0.2s",
              borderRadius: "50%",
            }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={e => !uploading && (e.currentTarget.style.opacity = "0")}
            >
              {uploading
                ? <div style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>Uploading…</div>
                : <>
                    <span style={{ fontSize: 18 }}>📷</span>
                    <div style={{ fontSize: 10, color: "#fff", fontWeight: 600, marginTop: 2 }}>Change</div>
                  </>
              }
            </div>
          </div>

          {/* Camera badge */}
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              position: "absolute", bottom: 0, right: 0,
              width: 26, height: 26, borderRadius: "50%",
              background: "var(--royal)", border: "2px solid var(--surface)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: 12,
            }}
          >
            📷
          </div>
        </div>

        {/* Name + role */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--text)", letterSpacing: 0.5, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {profile.name}
          </div>
          <div style={{ marginTop: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: "rgba(26,63,168,0.2)", color: roleColor }}>
              {roleLabel}
            </span>
          </div>
          {profile.position && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              #{profile.jersey} · {profile.position}
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={handleAvatarChange}
      />

      {/* Upload hint */}
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16, marginTop: -12 }}>
        Tap your photo to change it · JPEG, PNG, or WebP · Max 5MB
      </div>

      {/* Name editor */}
      <div style={{ marginBottom: 6 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Display Name
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSaveName()}
            maxLength={40}
            style={{
              flex: 1,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 12px",
              color: "var(--text)",
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button
            onClick={handleSaveName}
            disabled={saving || !name.trim() || name.trim() === profile.name}
            style={{
              background: name.trim() && name.trim() !== profile.name ? "var(--royal)" : "var(--surface2)",
              color: name.trim() && name.trim() !== profile.name ? "#fff" : "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: saving ? "wait" : "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.15s",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Grade selector */}
      <div style={{ marginTop: 14 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Grade / Level
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={grade}
            onChange={e => setGrade(e.target.value)}
            style={{
              flex: 1,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 12px",
              color: "var(--text)",
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
            }}
          >
            {GRADE_CATEGORIES.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <button
            onClick={handleSaveGrade}
            disabled={savingGrade || grade === profile.grade_category}
            style={{
              background: grade !== profile.grade_category ? "var(--royal)" : "var(--surface2)",
              color: grade !== profile.grade_category ? "#fff" : "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: savingGrade ? "wait" : "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.15s",
            }}
          >
            {savingGrade ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {toast && (
        <div style={{
          marginTop: 12,
          padding: "10px 14px",
          background: toast.startsWith("❌") || toast.startsWith("Error")
            ? "rgba(255,107,107,0.15)" : "rgba(40,180,80,0.15)",
          border: `1px solid ${toast.startsWith("❌") || toast.startsWith("Error") ? "rgba(255,107,107,0.3)" : "rgba(40,180,80,0.3)"}`,
          borderRadius: 8,
          fontSize: 13,
          color: toast.startsWith("❌") || toast.startsWith("Error") ? "#ff7b7b" : "#5de098",
          fontWeight: 600,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
