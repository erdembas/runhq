import { useEffect, useRef, useState } from 'react';
import type { LayoutNode } from '../layoutModel';
import { listGroupsLite } from './listGroupsLite';

export function useFocusedGroup(root: LayoutNode) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const pane = target.closest('[data-pane-id]') as HTMLElement | null;
      if (!pane) return;
      const id = pane.getAttribute('data-pane-id');
      if (id) setFocusedGroupId(id);
    };
    el.addEventListener('focusin', update);
    el.addEventListener('pointerdown', update, true);
    return () => {
      el.removeEventListener('focusin', update);
      el.removeEventListener('pointerdown', update, true);
    };
  }, []);

  useEffect(() => {
    if (focusedGroupId == null) return;
    const stillExists = listGroupsLite(root).some((id) => id === focusedGroupId);
    if (!stillExists) setFocusedGroupId(null);
  }, [root, focusedGroupId]);

  return { containerRef, focusedGroupId };
}
