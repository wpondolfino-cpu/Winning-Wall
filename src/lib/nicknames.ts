// src/lib/nicknames.ts
// Short names for practice printouts and the player's practice view.
//
// Someone's short name is the nickname a coach (or they) set, otherwise
// the automatic short form of their first name ("Daniel" -> "Dan"),
// otherwise just their first name. When two people on the same sheet end
// up with the same short name, a last initial is added ("Chris J.",
// "Chris M."), with more letters if that still clashes.
//
// Nicknames only change what prints. Everywhere else keeps full names.

import { supabase } from "./supabase";

// Only names whose short form is near-universal. Anything not here keeps
// its first name; a coach can still type a nickname for that one person.
const SHORT_FORMS: Record<string, string> = {
  benjamin: "Ben",
  christopher: "Chris",
  nicholas: "Nick", nicholai: "Nick", nickolas: "Nick", nikolas: "Nick",
  alexander: "Alex",
  matthew: "Matt",
  jonathan: "Jon",
  zachary: "Zach",
  joshua: "Josh",
  daniel: "Dan",
  samuel: "Sam",
  jacob: "Jake",
  timothy: "Tim",
  nathan: "Nate", nathaniel: "Nate",
  michael: "Mike",
};

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

function splitName(full: string): { first: string; last: string } {
  const words = (full ?? "").trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1].toLowerCase())) words.pop();
  return { first: words[0] ?? "", last: words.length > 1 ? words[words.length - 1] : "" };
}

/** The automatic short form, used when no nickname is set: "Daniel Ortiz" -> "Dan". */
export function autoNickname(fullName: string): string {
  const { first } = splitName(fullName);
  return SHORT_FORMS[first.toLowerCase()] ?? first;
}

/** What someone's short name is before clashes are sorted out. */
export function shortName(fullName: string, nickname?: string | null): string {
  const nick = nickname?.trim();
  return nick || autoNickname(fullName) || (fullName ?? "").trim();
}

/**
 * Short names for everyone who'll appear together, keyed by id.
 *
 * Clashes are settled across the whole list, so a person reads the same
 * everywhere on the sheet. A clash adds the last initial; if that still
 * clashes, more of the last name, up to all of it.
 */
export function shortLabels(people: { id: string; name: string; nickname?: string | null }[]): Record<string, string> {
  const seen = new Set<string>();
  const unique = people.filter(p => !seen.has(p.id) && (seen.add(p.id), true));
  const base = new Map(unique.map(p => [p.id, shortName(p.name, p.nickname)]));

  const byShort = new Map<string, typeof unique>();
  unique.forEach(p => {
    const k = base.get(p.id)!.toLowerCase();
    byShort.set(k, [...(byShort.get(k) ?? []), p]);
  });

  const out: Record<string, string> = {};
  byShort.forEach(group => {
    if (group.length === 1) { out[group[0].id] = base.get(group[0].id)!; return; }
    const lasts = group.map(p => splitName(p.name).last);
    const longest = Math.max(1, ...lasts.map(l => l.length));
    // The fewest letters of the last name that tell everyone apart.
    let n = 1;
    for (; n < longest; n++) {
      const tags = lasts.map(l => l.slice(0, n).toLowerCase());
      if (new Set(tags).size === tags.length) break;
    }
    group.forEach((p, i) => {
      const last = lasts[i];
      const tag = !last ? "" : last.length <= n ? ` ${last}` : ` ${last.slice(0, n)}.`;
      out[p.id] = base.get(p.id)! + tag;
    });
  });
  return out;
}

/** The rule a nickname has to meet (matches the database check). */
export function nicknameProblem(nick: string): string | null {
  const t = nick.trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (t.length > 20) return "Keep it to 20 characters.";
  if (!/^\p{L}[\p{L} .'-]*$/u.test(t)) return "Letters, spaces, hyphens, apostrophes and periods only.";
  return null;
}

/**
 * Saves a nickname. Blank clears it, so the automatic short form comes
 * back. `lock` is for coaches: true stops the player changing it.
 */
export async function saveNickname(profileId: string, nick: string, lock?: boolean): Promise<{ error: string | null }> {
  const problem = nicknameProblem(nick);
  if (problem) return { error: problem };
  const { error } = await supabase.rpc("set_nickname", {
    target: profileId, nick: nick.trim() || null, lock: lock ?? null,
  });
  if (!error) return { error: null };
  if (/could not find the function|function .* does not exist/i.test(error.message)) {
    return { error: "Nicknames need SQL 212 run in Supabase first." };
  }
  return { error: error.message };
}
