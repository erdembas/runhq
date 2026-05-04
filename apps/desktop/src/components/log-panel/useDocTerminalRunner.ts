import { useCallback } from 'react';
import type { UseServiceLayoutResult } from '@/components/layout/useServiceLayout';
import { ipc } from '@/lib/ipc';
import { utf8ToBytes } from './model';

interface UseDocTerminalRunnerArgs {
  layout: UseServiceLayoutResult;
  serviceId: string;
}

export function useDocTerminalRunner({ layout, serviceId }: UseDocTerminalRunnerArgs) {
  return useCallback(
    (command: string) => {
      if (!serviceId) return;
      const targetId = layout.ensureTerminal();
      if (!targetId) return;
      window.setTimeout(() => {
        const bytes = utf8ToBytes(`${command}\r`);
        void ipc.terminalWrite(targetId, bytes).catch((err) => {
          console.warn('docs: terminal_write failed', err);
        });
      }, 250);
    },
    [serviceId, layout],
  );
}
