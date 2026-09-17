import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand';

/** Keep mounted views (and their drafts/terminals) quiet until they become visible again. */
export function useVisibleStore<State, Selection>(
  store: Pick<StoreApi<State>, 'getState' | 'subscribe'>,
  selector: (state: State) => Selection,
  visible: boolean,
) {
  const snapshot = useRef(store.getState());
  const subscribe = useCallback(
    (onChange: () => void) => (visible ? store.subscribe(onChange) : () => {}),
    [store, visible],
  );
  const getSnapshot = () => {
    if (visible) snapshot.current = store.getState();
    return selector(snapshot.current);
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
