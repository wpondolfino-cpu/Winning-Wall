// src/lib/avatarBuilder.ts
// Generates a memoji-style illustrated avatar (skin tone, hair, eyes, mouth)
// using DiceBear's open-source "avataaars" style, entirely client-side — no
// external network calls at generation time. The result is an SVG, which we
// wrap in a File and hand to the existing uploadAvatar() pipeline, so it
// lands in the exact same avatar_url slot a photo upload would.
//
// NOTE: the option values below (topStyles, eyeStyles, etc.) are DiceBear's
// documented avataaars trait names as of writing. Once @dicebear/collection
// is actually installed, double-check these against its shipped TypeScript
// types (or https://www.dicebear.com/styles/avataaars/) — DiceBear
// occasionally renames or adds trait values between versions, and the
// installed package's types are the authoritative source, not this comment.

import { createAvatar } from "@dicebear/core";
import { avataaars } from "@dicebear/collection";

export interface AvatarConfig {
  skinColor: string;
  hairColor: string;
  top: string;
  eyes: string;
  mouth: string;
}

export const SKIN_TONES: { value: string; label: string }[] = [
  { value: "ffdbb4", label: "Light" },
  { value: "edb98a", label: "Fair" },
  { value: "fd9841", label: "Tan" },
  { value: "d08b5b", label: "Medium" },
  { value: "ae5d29", label: "Deep" },
  { value: "614335", label: "Dark" },
];

export const HAIR_COLORS: { value: string; label: string }[] = [
  { value: "0e0e0e", label: "Black" },
  { value: "3eac2c", label: "Green" },
  { value: "6a4e35", label: "Brown" },
  { value: "a55728", label: "Auburn" },
  { value: "b58143", label: "Blonde" },
  { value: "e8e1e1", label: "Gray" },
];

export const TOP_STYLES: { value: string; label: string }[] = [
  { value: "shortFlat", label: "Short" },
  { value: "curly", label: "Curly" },
  { value: "straight01", label: "Straight" },
  { value: "bigHair", label: "Big hair" },
  { value: "bun", label: "Bun" },
  { value: "shortRound", label: "Buzzed" },
];

export const EYE_STYLES: { value: string; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "happy", label: "Happy" },
  { value: "wink", label: "Wink" },
  { value: "squint", label: "Squint" },
  { value: "surprised", label: "Surprised" },
];

export const MOUTH_STYLES: { value: string; label: string }[] = [
  { value: "smile", label: "Smile" },
  { value: "default", label: "Neutral" },
  { value: "twinkle", label: "Twinkle" },
  { value: "serious", label: "Serious" },
  { value: "tongue", label: "Tongue out" },
];

export function defaultAvatarConfig(): AvatarConfig {
  return {
    skinColor: SKIN_TONES[0].value,
    hairColor: HAIR_COLORS[0].value,
    top: TOP_STYLES[0].value,
    eyes: EYE_STYLES[0].value,
    mouth: MOUTH_STYLES[0].value,
  };
}

/** A data: URI for live preview — cheap to regenerate on every trait change. */
export function avatarPreviewUri(config: AvatarConfig): string {
  const avatar = createAvatar(avataaars, {
    seed: "preview",
    skinColor: [config.skinColor],
    hairColor: [config.hairColor],
    top: [config.top as any],
    eyes: [config.eyes as any],
    mouth: [config.mouth as any],
    backgroundColor: ["transparent"],
  });
  return avatar.toDataUri();
}

/** The saved SVG, wrapped as a File for the existing uploadAvatar() pipeline. */
export function avatarConfigToFile(config: AvatarConfig): File {
  const avatar = createAvatar(avataaars, {
    seed: "saved-" + Date.now(),
    skinColor: [config.skinColor],
    hairColor: [config.hairColor],
    top: [config.top as any],
    eyes: [config.eyes as any],
    mouth: [config.mouth as any],
    backgroundColor: ["transparent"],
  });
  const svg = avatar.toString();
  return new File([svg], "avatar.svg", { type: "image/svg+xml" });
}
