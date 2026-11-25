// src/hooks/useAuth.ts
import { useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase, getProfile, Profile } from "../lib/supabase";

export type AuthState =
  | "loading"
  | "invite"        // came from an invite link — must set password
  | "recovery"      // came from a password reset link
  | "authenticated" // fully logged in
  | "unauthenticated";

export function useAuth() {
  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authState, setAuthState] = useState<AuthState>("loading");

  // Something to tell the person about a sign-in link they just opened:
  // "you're now signed in as Marcus", or "that link has expired".
  const [linkNotice, setLinkNotice] = useState<string | null>(null);

  useEffect(() => {
    // ── A sign-in link? ──
    // Invite, one-time sign-in and password-reset links land here with
    // #access_token=…&type=… in the address (or #error=… when Supabase
    // turned the link down).
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const tokenType = params.get("type");
    const clearAddress = () => window.history.replaceState(window.history.state, document.title, window.location.pathname + window.location.search);

    async function normalCheck() {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setAuthState("unauthenticated");
    }

    if (params.get("error")) {
      clearAddress();
      const code = params.get("error_code") ?? "";
      setLinkNotice(/expired|otp/i.test(code + " " + (params.get("error_description") ?? ""))
        ? "That sign-in link has expired or was already used. Ask whoever sent it to make you a new one."
        : `That sign-in link didn't work: ${params.get("error_description") ?? params.get("error")}.`);
      normalCheck();
    } else if (accessToken) {
      (async () => {
        // Whoever was signed in here before the link was opened.
        const { data: { session: before } } = await supabase.auth.getSession();
        // The link's account takes over, even if someone else was signed in.
        const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: params.get("refresh_token") ?? "" });
        clearAddress();
        if (error || !data.session) {
          setLinkNotice("That sign-in link didn't work. It may have expired; ask whoever sent it to make you a new one.");
          normalCheck();
          return;
        }
        const now = data.session.user;
        if (before?.user && before.user.id !== now.id) {
          const who = (now.user_metadata as any)?.name || now.email || "the invited account";
          setLinkNotice(`You're now signed in as ${who}, from the link you opened. To get back to your own account, sign out and sign in again.`);
        }
        setSession(data.session);
        setUser(now);
        // Invites always start with choosing a password; reset links too.
        if (tokenType === "invite" || tokenType === "signup") setAuthState("invite");
        else if (tokenType === "recovery") setAuthState("recovery");
        loadProfile(now.id);
      })();
    } else {
      normalCheck();
    }

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setProfile(null);
        setAuthState("unauthenticated");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId: string) {
    try {
      const p = await getProfile(userId);
      setProfile(p);
      // Only set authenticated if not already in invite/recovery flow
      setAuthState(prev => {
        if (prev === "invite" || prev === "recovery") return prev;
        return p ? "authenticated" : "unauthenticated";
      });
    } catch {
      setAuthState("unauthenticated");
    }
  }

  return { user, profile, session, authState, linkNotice, clearLinkNotice: () => setLinkNotice(null) };
}
