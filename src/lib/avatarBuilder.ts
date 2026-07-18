// src/lib/avatarBuilder.ts
// Generates a memoji-style illustrated avatar using DiceBear's open-source
// "avataaars" style, entirely client-side — no external network calls at
// generation time. The result is an SVG, which we wrap in a File and hand
// to the existing uploadAvatar() pipeline, so it lands in the exact same
// avatar_url slot a photo upload would.
//
// NOTE: the option values below are DiceBear's documented avataaars trait
// names as of writing. The "top" values are confirmed directly from a real
// TypeScript build error against the installed package; the rest are
// well-known standard avataaars values but haven't been build-verified the
// same way — if a build error names an invalid value here, that's the spot
// to check, same as happened with the first version of this file.

import { createAvatar } from "@dicebear/core";
import { avataaars } from "@dicebear/collection";

export interface AvatarConfig {
  skinColor: string;
  hairColor: string;
  top: string;
  eyes: string;
  eyebrows: string;
  mouth: string;
  facialHair: string;
  facialHairColor: string;
  accessories: string;
  clothesColor: string;
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
  { value: "bun", label: "Bun" },
  { value: "shortRound", label: "Buzzed" },
  { value: "curvy", label: "Curvy" },
  { value: "turban", label: "Turban" },
  { value: "fro", label: "Afro" },
  { value: "dreads", label: "Dreads" },
  { value: "dreads01", label: "Dreads (short)" },
  { value: "dreads02", label: "Dreads (long)" },
  { value: "sides", label: "Sides" },
  { value: "theCaesar", label: "Caesar" },
  { value: "theCaesarAndSidePart", label: "Caesar w/ part" },
  { value: "shaggyMullet", label: "Shaggy mullet" },
  { value: "shortCurly", label: "Short curly" },
];

export const EYE_STYLES: { value: string; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "happy", label: "Happy" },
  { value: "wink", label: "Wink" },
  { value: "squint", label: "Squint" },
  { value: "surprised", label: "Surprised" },
];

export const EYEBROW_STYLES: { value: string; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "raisedExcited", label: "Raised" },
  { value: "angry", label: "Angry" },
  { value: "sadConcerned", label: "Sad" },
  { value: "unibrowNatural", label: "Unibrow" },
  { value: "upDown", label: "Up-down" },
];

export const MOUTH_STYLES: { value: string; label: string }[] = [
  { value: "smile", label: "Smile" },
  { value: "default", label: "Neutral" },
  { value: "twinkle", label: "Twinkle" },
  { value: "serious", label: "Serious" },
  { value: "tongue", label: "Tongue out" },
];

export const FACIAL_HAIR_STYLES: { value: string; label: string }[] = [
  { value: "blank", label: "None" },
  { value: "beardLight", label: "Light beard" },
  { value: "beardMedium", label: "Full beard" },
  { value: "beardMajestic", label: "Long beard" },
  { value: "moustacheFancy", label: "Fancy mustache" },
  { value: "moustacheMagnum", label: "Mustache" },
];

export const ACCESSORY_STYLES: { value: string; label: string }[] = [
  { value: "blank", label: "None" },
  { value: "round", label: "Round" },
  { value: "wayfarers", label: "Wayfarers" },
  { value: "prescription01", label: "Prescription" },
  { value: "sunglasses", label: "Sunglasses" },
];

// Named DiceBear clothesColor values (not raw hex) — swatch below is just
// an approximation for the picker button's own display color.
// Same format as SKIN_TONES/HAIR_COLORS — clothesColor is a hex color like
// every other *Color field, not a named enum. Using named values here
// (e.g. "blue03") was the actual bug — DiceBear couldn't parse them as a
// color at all, so the jersey shape silently failed to render.
export const JERSEY_COLORS: { value: string; label: string }[] = [
  { value: "378add", label: "Blue" },
  { value: "d85a30", label: "Red" },
  { value: "2c2c2a", label: "Black" },
  { value: "f1efe8", label: "White" },
  { value: "639922", label: "Green" },
  { value: "5f5e5a", label: "Gray" },
];

export function defaultAvatarConfig(): AvatarConfig {
  return {
    skinColor: SKIN_TONES[0].value,
    hairColor: HAIR_COLORS[0].value,
    top: TOP_STYLES[0].value,
    eyes: EYE_STYLES[0].value,
    eyebrows: EYEBROW_STYLES[0].value,
    mouth: MOUTH_STYLES[0].value,
    facialHair: FACIAL_HAIR_STYLES[0].value,
    facialHairColor: HAIR_COLORS[0].value,
    accessories: ACCESSORY_STYLES[0].value,
    clothesColor: JERSEY_COLORS[0].value,
  };
}

// Same fixed seed used for both preview and the final save — the seed
// determines how DiceBear resolves any trait we don't explicitly set below,
// so using two different seeds (as an earlier version of this file did) let
// unpinned traits quietly differ between what was previewed and what
// actually got saved. Every trait that matters is now explicitly set
// either way, but keeping this shared is cheap insurance.
const AVATAR_SEED = "winning-wall-avatar";

function buildOptions(config: AvatarConfig) {
  return {
    seed: AVATAR_SEED,
    // Explicit pixel size, not just a viewBox — an SVG with no explicit
    // width/height can report a zero natural size in some loading contexts
    // (notably three.js's TextureLoader), which fails to load with no
    // visible error at all.
    size: 256,
    skinColor: [config.skinColor],
    hairColor: [config.hairColor],
    top: [config.top as any],
    eyes: [config.eyes as any],
    eyebrows: [config.eyebrows as any],
    mouth: [config.mouth as any],
    facialHair: [config.facialHair as any],
    facialHairColor: [config.facialHairColor],
    // "blank" means no glasses — probability 0 keeps DiceBear from ever
    // substituting a different accessory in that case regardless.
    accessories: [config.accessories as any],
    accessoriesProbability: config.accessories === "blank" ? 0 : 100,
    facialHairProbability: config.facialHair === "blank" ? 0 : 100,
    // Jersey — pinned to a single plain shirt shape; only the color is a
    // real player-facing choice.
    clothes: ["shirtCrewNeck" as any],
    clothesColor: [config.clothesColor],
    backgroundColor: ["transparent"],
  };
}

/** A data: URI for live preview — cheap to regenerate on every trait change. */
export function avatarPreviewUri(config: AvatarConfig): string {
  return createAvatar(avataaars, buildOptions(config)).toDataUri();
}

/** The saved SVG, wrapped as a File for the existing uploadAvatar() pipeline. */
export function avatarConfigToFile(config: AvatarConfig): File {
  const svg = createAvatar(avataaars, buildOptions(config)).toString();
  return new File([svg], "avatar.svg", { type: "image/svg+xml" });
}
