import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ipc } from '@/lib/ipc';
import { hasSeenTrayHint, markTrayHintSeen } from '@/lib/onboarding';

export function useTrayHint() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void (async () => {
      unlisten = await listen('runhq://main-will-hide', () => {
        if (hasSeenTrayHint()) return;

        markTrayHintSeen();
        window.setTimeout(() => {
          ipc.showTrayHint().catch((err) => {
            console.error('show_tray_hint failed', err);
          });
        }, 180);
      });
    })();

    return () => {
      unlisten?.();
    };
  }, []);
}
