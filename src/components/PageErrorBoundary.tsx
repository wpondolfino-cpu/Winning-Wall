// src/components/PageErrorBoundary.tsx
// A safety net around each page. If a page crashes while drawing (like
// React error #310 on the Players page), only that page shows a "Something
// went wrong" card -- the sidebar, the tab bar and every other page keep
// working. Without it, one broken page blanked the whole app.
//
// App.tsx keys this by the current tab, so moving to another page always
// starts fresh; "Try again" re-draws the same page.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Still logged, so the console shows what broke and where.
    console.error("Page crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 520, margin: "40px auto", padding: "20px 22px", textAlign: "center",
        background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14 }}>
        <div style={{ fontSize: 30, marginBottom: 6 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Something went wrong on this page</div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginBottom: 16 }}>
          The rest of the app still works — pick another page from the menu, or try this one again.
          If it keeps happening, a screenshot of the browser console helps track it down.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => this.setState({ error: null })}
            style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()}
            style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
            Reload the app
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 14, wordBreak: "break-word" }}>
          {String(this.state.error.message || this.state.error).slice(0, 200)}
        </div>
      </div>
    );
  }
}
