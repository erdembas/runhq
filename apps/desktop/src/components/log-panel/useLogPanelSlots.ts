import { useCallback, useState } from 'react';

export function useLogPanelSlots() {
  const [bodySlots, setBodySlots] = useState<Map<string, HTMLDivElement>>(() => new Map());
  const onSlotRef = useCallback((tabId: string, el: HTMLDivElement | null) => {
    setBodySlots((prev) => {
      if (el) {
        if (prev.get(tabId) === el) return prev;
        const next = new Map(prev);
        next.set(tabId, el);
        return next;
      }
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  return { bodySlots, onSlotRef };
}
