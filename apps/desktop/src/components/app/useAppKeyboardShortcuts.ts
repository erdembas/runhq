import { useEffect } from 'react';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';

export function useAppKeyboardShortcuts() {
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key !== 'k' && key !== 'l') return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      event.preventDefault();
      if (key === 'k') {
        void ipc.showQuickAction().catch((err) => console.error('show_quick_action failed', err));
      } else {
        toggleRightPanel('ai');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleRightPanel]);
}
