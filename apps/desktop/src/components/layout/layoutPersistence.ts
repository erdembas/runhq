/**
 * Per-service layout persistence. Auto-saves a debounced copy of
 * the layout state to `localStorage` whenever it changes; rehydrates
 * synchronously on first mount so the user lands on the same panes
 * they had last session.
 *
 * Schema is versioned (`v1`) so a future breaking change can ship
 * `v2` without crashing on a stale `v1` blob — the loader checks
 * the version field and falls back to defaults silently.
 *
 * We deliberately persist the FULL state (tree + tab table +
 * counter) rather than the user-meaningful subset because the
 * tree references tabs by id — losing the tab table would leave
 * dangling references and a broken layout. The blob is small
 * (~hundreds of bytes for typical layouts) so the simplicity is
 * worth the few extra bytes.
 */

import { defaultLayoutState, type LayoutState } from './layoutModel';

const SCHEMA_VERSION = 1;
const KEY_PREFIX = `runhq:layout:v${SCHEMA_VERSION}:`;

interface Envelope {
  version: number;
  state: LayoutState;
}

function key(serviceId: string): string {
  return `${KEY_PREFIX}${serviceId}`;
}

/**
 * Load the persisted layout for `serviceId`, or the factory default
 * if nothing's stored or the blob is malformed. Always returns a
 * valid state; never throws.
 */
export function loadLayout(serviceId: string): LayoutState {
  if (typeof window === 'undefined') return defaultLayoutState();
  try {
    const raw = window.localStorage.getItem(key(serviceId));
    if (!raw) return defaultLayoutState();
    const env = JSON.parse(raw) as Envelope;
    if (!env || env.version !== SCHEMA_VERSION || !env.state) {
      return defaultLayoutState();
    }
    // Sanity-check the loaded state. A corrupted blob (root-less
    // tree, missing tabs table) silently falls back to default
    // rather than crashing the whole panel render.
    if (!env.state.root || !env.state.tabs || typeof env.state.nextTermIdx !== 'number') {
      return defaultLayoutState();
    }
    return env.state;
  } catch {
    return defaultLayoutState();
  }
}

/**
 * Persist `state` for `serviceId`. Synchronous I/O; callers should
 * debounce via the `usePersistedLayout` hook (which is what the
 * actual UI uses) rather than calling this on every reducer
 * action.
 */
export function saveLayout(serviceId: string, state: LayoutState): void {
  if (typeof window === 'undefined') return;
  try {
    const env: Envelope = { version: SCHEMA_VERSION, state };
    window.localStorage.setItem(key(serviceId), JSON.stringify(env));
  } catch {
    // localStorage quota exceeded / private mode disables setItem
    // — degrade silently. The user's session keeps working; only
    // the persistence is lost.
  }
}

/** "Reset layout" header button — wipe persistence for this service. */
export function clearLayout(serviceId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key(serviceId));
  } catch {
    // Same rationale as saveLayout — silent degrade.
  }
}
