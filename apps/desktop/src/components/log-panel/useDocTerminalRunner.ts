import { useCallback, useRef, useState } from 'react';
import type { UseServiceLayoutResult } from '@/components/layout/useServiceLayout';
import { ipc } from '@/lib/ipc';
import { utf8ToBytes } from './model';
import {
  createProjectCommandQueue,
  projectTerminalId,
} from '@/components/workbench/projectTerminalModel';
import { openProjectSection } from '@/lib/workbenchNavigation';

interface UseDocTerminalRunnerArgs {
  layout: UseServiceLayoutResult;
  serviceId: string;
}

export function useDocTerminalRunner({ layout, serviceId }: UseDocTerminalRunnerArgs) {
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<ReturnType<typeof createProjectCommandQueue>>();
  if (!queueRef.current) {
    queueRef.current = createProjectCommandQueue((id, command) =>
      ipc.terminalWrite(id, utf8ToBytes(`${command}\r`)),
    );
  }
  queueRef.current.onError((cause) => setError(String(cause)));
  const runCommand = useCallback(
    (command: string) => {
      if (!serviceId) return;
      const targetId = layout.ensureTerminal();
      if (!targetId) return;
      setError(null);
      queueRef.current!.enqueue(projectTerminalId(serviceId, targetId), command);
      openProjectSection(serviceId, 'run');
    },
    [serviceId, layout],
  );
  const terminalReady = useCallback((id: string) => queueRef.current!.ready(id), []);
  const terminalClosed = useCallback((id: string) => queueRef.current!.closed(id), []);
  return { runCommand, terminalReady, terminalClosed, error };
}
