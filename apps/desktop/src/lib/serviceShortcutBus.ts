/**
 * Module-level registry that lets `useViewShortcuts` (a window-level
 * keyboard listener) reach into a service tab's layout state without
 * prop-drilling or Context plumbing.
 *
 * Why a registry instead of Context? `useViewShortcuts` is mounted
 * at the App root, but the handler that knows how to "open a new
 * terminal in the active service" lives inside the per-service
 * `LogPanel` (it owns the layout reducer). Wrapping the whole tree
 * in a Context just to share a couple of callbacks would force
 * every render in the tree to consider the shortcut object, which
 * is the opposite of what we want — the shortcut layer should be
 * invisible until a key is pressed.
 *
 * Each `LogPanel` calls `register(serviceId, handlers)` on mount and
 * the matching `unregister(serviceId)` on unmount. The dispatcher
 * looks up the handler by *active service id* (from the store) and
 * delegates if the service tab is the focused one. If no handler is
 * registered (e.g. the active main tab is the dashboard, not a
 * service), the shortcut becomes a no-op rather than firing on a
 * stale service.
 */

export interface ServiceShortcutHandlers {
  /**
   * Spawn a new terminal in the service's preferred pane. Called
   * by the `new_terminal` view shortcut. Returns `void`; the
   * implementation is expected to focus the new terminal itself
   * because the user just chorded "new terminal" and expects to
   * type into it immediately.
   */
  newTerminal: () => void;
}

const registry = new Map<string, ServiceShortcutHandlers>();

export function registerServiceShortcuts(
  serviceId: string,
  handlers: ServiceShortcutHandlers,
): () => void {
  registry.set(serviceId, handlers);
  return () => {
    // Only forget if we're still the registered owner — if the
    // service was rapidly re-mounted (e.g. via a tab reorder) the
    // newer handler may have already taken our slot, and a stale
    // unregister would wipe it out.
    if (registry.get(serviceId) === handlers) {
      registry.delete(serviceId);
    }
  };
}

export function getServiceShortcuts(serviceId: string): ServiceShortcutHandlers | undefined {
  return registry.get(serviceId);
}
