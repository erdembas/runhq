import { useEffect, useRef } from 'react';
import type { Shortcuts } from '@/types';
import {
  canonicalizeChord,
  chordFromKeyboardEvent,
  DEFAULT_SHORTCUTS,
  SHORTCUT_CATALOG,
  type ShortcutId,
} from './shortcuts';

/**
 * Subset of `Shortcuts` keys that are dispatched from inside the
 * React window listener (i.e. not the OS-level globals). Derived
 * from the catalogue so adding a new view shortcut in
 * `lib/shortcuts.ts` automatically extends this type — no parallel
 * list to keep in sync.
 */
export type ViewShortcutId = Extract<
  ShortcutId,
  | 'toggle_left_sidebar'
  | 'toggle_ai_panel'
  | 'toggle_activity_panel'
  | 'new_terminal'
  | 'next_main_tab'
  | 'prev_main_tab'
  | 'close_main_tab'
>;

export type ViewShortcutHandlers = Partial<Record<ViewShortcutId, () => void>>;

/**
 * Wire window-level shortcuts to a set of action callbacks.
 *
 * The hook binds a single `keydown` listener at the window root
 * (capture phase, so it sees keystrokes before any focused element
 * other than dedicated input surfaces). On every keystroke we
 * compute the canonical chord and look it up in the user's stored
 * bindings. If a binding maps to one of the supplied handlers, the
 * default browser behaviour is suppressed and the handler runs.
 *
 * The handlers are stashed in a ref so we don't tear down and
 * re-bind the listener on every render — only the binding *map*
 * changes need a re-bind, and even those just rebuild the lookup
 * table, not the DOM listener.
 */
export function useViewShortcuts(
  shortcuts: Shortcuts | null | undefined,
  handlers: ViewShortcutHandlers,
) {
  const handlersRef = useRef<ViewShortcutHandlers>(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    // Build a chord → action-id lookup once per binding change. The
    // lookup is keyed by canonical chord string, so any combination
    // of modifier aliases (`Cmd+B`, `CmdOrCtrl+B`, `Meta+B`) all
    // resolve to the same entry.
    const viewIds = SHORTCUT_CATALOG.filter((m) => m.scope === 'view').map(
      (m) => m.id as ViewShortcutId,
    );
    const lookup = new Map<string, ViewShortcutId>();
    for (const id of viewIds) {
      const raw = (shortcuts?.[id] as string | undefined) ?? DEFAULT_SHORTCUTS[id];
      if (!raw) continue;
      const chord = canonicalizeChord(raw);
      if (!chord) continue;
      // Last write wins on duplicate chords. The settings UI flags
      // conflicts up front so this should be unreachable in practice,
      // but if a user really insists on binding two actions to the
      // same chord we don't want to silently fire both.
      lookup.set(chord, id);
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Compute the chord first, *then* decide whether to fire — and
      // crucially, do it BEFORE filtering out input surfaces. The
      // earlier "skip everything in inputs" gate broke the toggle
      // case: pressing `Cmd+Shift+A` opens the AI panel which
      // auto-focuses its composer textarea, so the *second*
      // `Cmd+Shift+A` arrives at a textarea target and used to be
      // silently dropped.
      //
      // The right model is: if the user pressed a chord that's
      // explicitly bound in the shortcut catalogue, the catalogue
      // wins. Bound chords always include a modifier (we enforce it
      // in the settings dialog), so this can't accidentally swallow
      // a plain letter the user typed into a search box. A typed
      // `b` while the cursor is in a textarea won't match any
      // canonical chord (no modifier → no `mod`/`ctrl` token), so
      // typing remains untouched. Only chords that the user
      // *explicitly bound* are intercepted, regardless of focus.
      const chord = chordFromKeyboardEvent(e);
      if (!chord) return;
      const id = lookup.get(chord);
      if (!id) return;
      const handler = handlersRef.current[id];
      if (!handler) return;
      e.preventDefault();
      e.stopPropagation();
      handler();
    };

    // Capture phase so the dispatcher fires before component-level
    // `onKeyDown`s — except for the input filter above, which
    // explicitly opts those surfaces out.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [shortcuts]);
}
