// src/components/AvatarBuilder.tsx
// Memoji-style avatar picker — skin tone, hair, eyes, mouth — with a live
// preview. Saves through the same uploadAvatar() pipeline a photo upload
// uses, so it plugs into every existing avatar_url consumer (2D/3D plays,
// roster, profile) with no changes needed there.
import { useState } from "react";
import { Profile, uploadAvatar, saveAvatarConfig } from "../lib/supabase";
import {
  AvatarConfig, defaultAvatarConfig, avatarPreviewUri, avatarConfigToFile,
  SKIN_TONES, HAIR_COLORS, TOP_STYLES, EYE_STYLES, EYEBROW_STYLES, MOUTH_STYLES,
  FACIAL_HAIR_STYLES, ACCESSORY_STYLES, JERSEY_COLORS,
} from "../lib/avatarBuilder";

interface Props {
  profile: Profile;
  onSaved: (avatarUrl: string) => void;
  onCancel?: () => void;
  /** Their previously saved trait selections, if any — lets reopening the builder start from what they already picked instead of the defaults. */
  initialConfig?: AvatarConfig | null;
}

function ColorRow({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={o.label}
            style={{
              width: 30, height: 30, borderRadius: "50%",
              background: "#" + o.value,
              border: value === o.value ? "2.5px solid var(--gold)" : "2px solid var(--border)",
              cursor: "pointer", padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PickRow({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              padding: "6px 12px", fontSize: 12, borderRadius: 8,
              border: value === o.value ? "2px solid var(--gold)" : "1px solid var(--border)",
              background: value === o.value ? "rgba(240,192,64,0.12)" : "var(--surface2)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AvatarBuilder({ profile, onSaved, onCancel, initialConfig }: Props) {
  const [config, setConfig] = useState<AvatarConfig>(initialConfig ?? defaultAvatarConfig());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  function set<K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const file = avatarConfigToFile(config);
      const url = await uploadAvatar(profile.id, file);
      await saveAvatarConfig(profile.id, config);
      onSaved(url);
    } catch (e: any) {
      setToast("Error: " + e.message);
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <div style={{ width: 110, height: 110, borderRadius: "50%", overflow: "hidden", border: "2px solid var(--royal)", background: "var(--surface2)" }}>
          <img src={avatarPreviewUri(config)} alt="Avatar preview" style={{ width: "100%", height: "100%" }} />
        </div>
      </div>

      <ColorRow label="Skin tone" options={SKIN_TONES} value={config.skinColor} onChange={(v) => set("skinColor", v)} />
      <PickRow label="Hair style" options={TOP_STYLES} value={config.top} onChange={(v) => set("top", v)} />
      <ColorRow label="Hair color" options={HAIR_COLORS} value={config.hairColor} onChange={(v) => set("hairColor", v)} />
      <PickRow label="Eyes" options={EYE_STYLES} value={config.eyes} onChange={(v) => set("eyes", v)} />
      <PickRow label="Eyebrows" options={EYEBROW_STYLES} value={config.eyebrows} onChange={(v) => set("eyebrows", v)} />
      <PickRow label="Mouth" options={MOUTH_STYLES} value={config.mouth} onChange={(v) => set("mouth", v)} />
      <PickRow label="Facial hair" options={FACIAL_HAIR_STYLES} value={config.facialHair} onChange={(v) => set("facialHair", v)} />
      {config.facialHair !== "blank" && (
        <ColorRow label="Facial hair color" options={HAIR_COLORS} value={config.facialHairColor} onChange={(v) => set("facialHairColor", v)} />
      )}
      <PickRow label="Glasses" options={ACCESSORY_STYLES} value={config.accessories} onChange={(v) => set("accessories", v)} />
      <ColorRow label="Jersey color" options={JERSEY_COLORS} value={config.clothesColor} onChange={(v) => set("clothesColor", v)} />

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {onCancel && <button onClick={onCancel} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontFamily: "inherit" }}>Cancel</button>}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: "var(--royal)", color: "#fff", fontFamily: "inherit", fontWeight: 600, cursor: saving ? "wait" : "pointer" }}
        >
          {saving ? "Saving…" : "Save avatar"}
        </button>
      </div>

      {toast && <p style={{ fontSize: 13, color: "#ff7b7b", marginTop: 10, textAlign: "center" }}>{toast}</p>}
    </div>
  );
}
