import { useCallback, useState } from 'react';

/**
 * `useState` for booleans whose value should survive across sessions.
 * Reads from `localStorage` on first render, writes back on every set.
 *
 * Designed for UI preferences that don't justify their own slice in the
 * Zustand store — single-screen toggles like "is this side panel
 * collapsed?", "is the legend pinned?", and so on. Anything that other
 * components actually *react to* across the tree should still live in
 * the store.
 *
 * Failures (private mode, blocked storage) fall back gracefully to
 * in-memory state — the toggle still works for the current session,
 * we just lose persistence.
 */
export function usePersistentBoolean(
  storageKey: string,
  fallback: boolean,
): readonly [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setRaw] = useState<boolean>(() => {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw == null) return fallback;
      return raw === 'true';
    } catch {
      return fallback;
    }
  });

  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setRaw((prev) => {
        const final = typeof next === 'function' ? next(prev) : next;
        try {
          window.localStorage.setItem(storageKey, String(final));
        } catch {
          // Storage unavailable — toggle still works in memory, we
          // just drop the persistence promise this session.
        }
        return final;
      });
    },
    [storageKey],
  );

  return [value, set] as const;
}
