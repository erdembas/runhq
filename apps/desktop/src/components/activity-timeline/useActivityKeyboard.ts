import { useEffect, type RefObject } from 'react';
import {
  type ActivityTimelineStoreApi,
  useActivityTimelineStore,
} from './useActivityTimelineStore';

interface ActivityKeyboardOptions {
  isInline: boolean;
  collapsed: boolean;
  hoverOpen: boolean;
  onClose?: () => void;
  searchInputRef: RefObject<HTMLInputElement>;
}

export function useActivityKeyboard(
  store: ActivityTimelineStoreApi,
  { isInline, collapsed, hoverOpen, onClose, searchInputRef }: ActivityKeyboardOptions,
) {
  const modalEventId = useActivityTimelineStore(store, (state) => state.modalEventId);
  const selectedId = useActivityTimelineStore(store, (state) => state.selectedId);
  const patch = useActivityTimelineStore(store, (state) => state.patch);

  useEffect(() => {
    const panelVisible = isInline ? !collapsed || hoverOpen : true;
    if (!panelVisible) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (event.key === 'Escape') {
        if (modalEventId !== null) {
          patch({ modalEventId: null });
          return;
        }
        if (editable && target === searchInputRef.current) {
          patch({ search: '' });
          searchInputRef.current?.blur();
          return;
        }
        if (selectedId !== null) {
          patch({ selectedId: null });
          return;
        }
        if (!isInline && onClose) onClose();
      }
      if (event.key === '/' && !editable) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isInline, collapsed, hoverOpen, modalEventId, selectedId, onClose, patch, searchInputRef]);
}
