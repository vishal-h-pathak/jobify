/**
 * Device-local UI preferences (filters, sort, view mode) persisted to
 * localStorage. Deliberately not synced to Supabase — these are
 * per-browser working-state, not user data.
 */

export function loadPref<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function savePref<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can be full or disabled (private browsing) — the
    // preference simply won't survive the session.
  }
}
