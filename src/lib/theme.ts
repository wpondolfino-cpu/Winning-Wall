// src/lib/theme.ts
// Light / dark mode (migration 199). The choice is saved on the account
// (profiles.appearance) so it follows the person to every device; this
// device also keeps a copy so the right colours show before the profile
// has loaded, without a dark flash on a light-mode phone.
//
// The colours themselves live in global.css: dark is the default, and
// html[data-theme="light"] swaps the colour names for light ones.

import { supabase } from "./supabase";

export type Appearance = "dark" | "light" | "system";

const KEY = "ww_appearance";
let current: Appearance = "dark";
let media: MediaQueryList | null = null;

function systemPrefersLight(): boolean {
  try { return window.matchMedia("(prefers-color-scheme: light)").matches; } catch { return false; }
}

function paint() {
  const light = current === "light" || (current === "system" && systemPrefersLight());
  document.documentElement.dataset.theme = light ? "light" : "dark";
  // The browser's own bits (scrollbars, date pickers) follow along.
  document.documentElement.style.colorScheme = light ? "light" : "dark";
}

function onSystemChange() { if (current === "system") paint(); }

/** Applies an appearance and remembers it on this device. */
export function applyAppearance(a: Appearance | null | undefined) {
  current = a === "light" || a === "system" ? a : "dark";
  try { localStorage.setItem(KEY, current); } catch { /* storage blocked: fine */ }
  if (!media) {
    try {
      media = window.matchMedia("(prefers-color-scheme: light)");
      media.addEventListener?.("change", onSystemChange);
    } catch { /* very old browser: "system" just means dark */ }
  }
  paint();
}

/** At startup, before anything is drawn: this device's last choice. */
export function applySavedAppearance() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
  applyAppearance(saved as Appearance | null);
}

export function currentAppearance(): Appearance { return current; }

/** Saves the choice to the account and applies it straight away. */
export async function saveAppearance(a: Appearance): Promise<void> {
  applyAppearance(a);
  const { error } = await supabase.rpc("set_appearance", { p_appearance: a });
  if (error) throw error;
}
