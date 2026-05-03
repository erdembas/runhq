/**
 * Reducer + persistence wiring for `ServiceLayout`. Responsibilities:
 *
 *   1. Hydrate from `localStorage` on first mount (synchronous via
 *      `useReducer`'s lazy initialiser).
 *   2. Debounce save-back so a burst of activations / drag-resize
 *      events doesn't write 60 times per second.
 *   3. Expose a small action API (`activate`, `addTerminal`, etc.)
 *      so callers don't have to know the action shape.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import {
  defaultLayoutState,
  layoutReducer,
  preferredTerminalGroup,
  type LayoutAction,
  type LayoutState,
  type SplitEdge,
} from './layoutModel';
import { clearLayout, loadLayout, saveLayout } from './layoutPersistence';

/** Debounce window for `saveLayout`. Long enough to coalesce a
 *  rapid drag/resize burst, short enough that closing RunHQ
 *  immediately after a change still persists. */
const PERSIST_DEBOUNCE_MS = 250;

export interface UseServiceLayoutResult {
  state: LayoutState;
  // ---- Tab activation -----------------------------------------------------
  activate: (groupId: string, tabId: string) => void;
  // ---- Tab lifecycle ------------------------------------------------------
  addTerminal: (groupId?: string) => string;
  closeTab: (tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
  // ---- Drag/drop ----------------------------------------------------------
  moveTab: (tabId: string, targetGroupId: string, insertIndex?: number) => void;
  splitTab: (tabId: string, targetGroupId: string, edge: SplitEdge) => void;
  resizeSplit: (splitId: string, sizes: [number, number]) => void;
  // ---- External coordination ---------------------------------------------
  setIncludeDocs: (include: boolean) => void;
  reset: () => void;
  /** Find or spawn a terminal and return its id. Used by the docs tab's
   *  "Run" affordance and the quick-action "open terminal" deep link. */
  ensureTerminal: () => string;
}

export function useServiceLayout(serviceId: string): UseServiceLayoutResult {
  // Lazy initialiser: runs synchronously once per mount. The
  // parent already remounts on `key={serviceId}` so a service
  // switch tears down the whole hook tree and re-hydrates from
  // the new service's blob.
  const [state, dispatch] = useReducer(
    layoutReducer,
    serviceId,
    (id) => loadLayout(id) ?? defaultLayoutState(),
  );

  // Debounced persistence. The timer is reset on every state
  // change; the callback fires once activity quiets for
  // PERSIST_DEBOUNCE_MS. We deliberately skip the first render's
  // "post-init" save (state === just-loaded blob, writing it back
  // is a wasteful round-trip) by gating on a ref that flips after
  // the first effect.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    const id = window.setTimeout(() => {
      saveLayout(serviceId, state);
    }, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [serviceId, state]);

  // The dispatched action set is small and stable — bind callbacks
  // once and let consumers depend on them safely. We use a ref to
  // the latest state in the imperative-style helpers (`addTerminal`
  // returning the new id, `ensureTerminal` consulting the layout)
  // so we don't have to recompute callbacks on every state change.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const send = useCallback((action: LayoutAction) => dispatch(action), []);

  const activate = useCallback(
    (groupId: string, tabId: string) => send({ type: 'activate-tab', groupId, tabId }),
    [send],
  );

  const addTerminal = useCallback(
    (groupId?: string): string => {
      const target = groupId ?? preferredTerminalGroup(stateRef.current)?.id ?? null;
      if (!target) return '';
      const idxBefore = stateRef.current.nextTermIdx;
      send({ type: 'add-terminal', groupId: target });
      // The reducer assigns id `terminal-${idxBefore}` — predictable
      // because the counter increments deterministically. Returning
      // it lets the caller chain (e.g. write a command to the new
      // PTY immediately).
      return `terminal-${idxBefore}`;
    },
    [send],
  );

  const closeTab = useCallback((tabId: string) => send({ type: 'close-tab', tabId }), [send]);
  const renameTab = useCallback(
    (tabId: string, title: string) => send({ type: 'rename-tab', tabId, title }),
    [send],
  );

  const moveTab = useCallback(
    (tabId: string, targetGroupId: string, insertIndex?: number) =>
      send({ type: 'move-tab', tabId, targetGroupId, insertIndex }),
    [send],
  );

  const splitTab = useCallback(
    (tabId: string, targetGroupId: string, edge: SplitEdge) =>
      send({ type: 'split-tab', tabId, targetGroupId, edge }),
    [send],
  );

  const resizeSplit = useCallback(
    (splitId: string, sizes: [number, number]) => send({ type: 'resize-split', splitId, sizes }),
    [send],
  );

  const setIncludeDocs = useCallback(
    (include: boolean) => send({ type: 'set-include-docs', includeDocs: include }),
    [send],
  );

  const reset = useCallback(() => {
    clearLayout(serviceId);
    send({ type: 'reset' });
  }, [send, serviceId]);

  const ensureTerminal = useCallback((): string => {
    // First look for an existing terminal anywhere in the tree.
    const cur = stateRef.current;
    for (const tab of Object.values(cur.tabs)) {
      if (tab.kind === 'terminal') {
        // Activate it so the user lands on the live one.
        const group = preferredTerminalGroup(cur);
        if (group) send({ type: 'activate-tab', groupId: group.id, tabId: tab.id });
        return tab.id;
      }
    }
    // None exist — spawn one in the preferred group.
    return addTerminal();
  }, [addTerminal, send]);

  return useMemo<UseServiceLayoutResult>(
    () => ({
      state,
      activate,
      addTerminal,
      closeTab,
      renameTab,
      moveTab,
      splitTab,
      resizeSplit,
      setIncludeDocs,
      reset,
      ensureTerminal,
    }),
    [
      state,
      activate,
      addTerminal,
      closeTab,
      renameTab,
      moveTab,
      splitTab,
      resizeSplit,
      setIncludeDocs,
      reset,
      ensureTerminal,
    ],
  );
}
