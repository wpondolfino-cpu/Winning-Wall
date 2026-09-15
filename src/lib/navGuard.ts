// src/lib/navGuard.ts
// Lets a screen deep inside a tab object to being navigated away from,
// without App.tsx needing to know which screen is open.
//
// A screen registers a guard while it's mounted. The guard returns a
// message when leaving would throw away work (e.g. a half-entered
// possession in GameTracker) and null otherwise. Anything that moves the
// user to another screen -- sidebar clicks, the browser Back button, the
// tracker's own "← Games" button -- calls confirmNavAway() first.

type NavGuard = () => string | null;

const guards = new Set<NavGuard>();

/** Registers a guard. Returns the unregister function, so it can be used directly as a useEffect cleanup. */
export function registerNavGuard(guard: NavGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** True if it's fine to leave. Asks the user when a registered guard objects. */
export function confirmNavAway(): boolean {
  for (const guard of guards) {
    const message = guard();
    if (message) return window.confirm(message);
  }
  return true;
}
