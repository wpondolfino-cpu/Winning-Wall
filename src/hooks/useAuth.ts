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

  useEffect(() => {
    // ── Check URL for Supabase magic tokens first ──
    // When someone clicks an invite or reset link, Supabase puts
    // #access_token=...&type=invite (or type=recovery) in the URL
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace("#", "?"));
    const tokenType = params.get("type");
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (accessToken && (tokenType === "invite" || tokenType === "signup")) {
      // Player clicked invite link — sign them in and force password change
      supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken ?? "",
      }).then(({ data, error }) => {
        if (error || !data.session) {
          setAuthState("unauthenticated");
          return;
        }
        setSession(data.session);
        setUser(data.session.user);
        // Clear the ugly token from the URL bar
        window.history.replaceState({}, document.title, window.location.pathname);
        // Always force password change for invite links
        setAuthState("invite");
        loadProfile(data.session.user.id);
      });
      return;
    }

    if (accessToken && tokenType === "recovery") {
      // Password reset link
      supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken ?? "",
      }).then(({ data }) => {
        if (data.session) {
          setSession(data.session);
          setUser(data.session.user);
          window.history.replaceState({}, document.title, window.location.pathname);
          setAuthState("recovery");
          loadProfile(data.session.user.id);
        } else {
          setAuthState("unauthenticated");
        }
      });
      return;
    }

    // ── Normal session check ──
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setAuthState("unauthenticated");
      }
    });

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

  return { user, profile, session, authState };
}
