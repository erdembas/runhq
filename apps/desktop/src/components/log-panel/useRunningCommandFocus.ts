import { useEffect, useMemo, useRef } from 'react';
import type { UseServiceLayoutResult } from '@/components/layout/useServiceLayout';
import type { CommandStatus } from '@/types';

interface UseRunningCommandFocusArgs {
  commands: CommandStatus[];
  layout: UseServiceLayoutResult;
}

export function useRunningCommandFocus({ commands, layout }: UseRunningCommandFocusArgs) {
  const runningCmdNames = useMemo(
    () =>
      commands
        .filter((command) => command.status === 'running' || command.status === 'starting')
        .map((command) => command.name),
    [commands],
  );
  const runningCmdKey = useMemo(
    () => runningCmdNames.slice().sort().join('\x1f'),
    [runningCmdNames],
  );
  const prevRunningCmdsRef = useRef<string[]>([]);

  useEffect(() => {
    const prev = prevRunningCmdsRef.current;
    prevRunningCmdsRef.current = runningCmdNames;
    if (runningCmdNames.length === 0) return;
    const prevSet = new Set(prev);
    const newlyRunning = runningCmdNames.find((name) => !prevSet.has(name));
    if (!newlyRunning) return;
    layout.openCommandLog(newlyRunning);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningCmdKey]);
}
