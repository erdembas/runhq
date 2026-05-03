import { useEffect, useMemo, useRef } from 'react';
import { findGroupByTab } from '@/components/layout/layoutModel';
import type { useServiceLayout } from '@/components/layout/useServiceLayout';
import type { CommandStatus } from '@/types';

interface UseRunningCommandFocusArgs {
  commands: CommandStatus[];
  layout: ReturnType<typeof useServiceLayout>;
  setSelectedCmdName: (name: string) => void;
}

export function useRunningCommandFocus({
  commands,
  layout,
  setSelectedCmdName,
}: UseRunningCommandFocusArgs) {
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
  const layoutStateRef = useRef(layout.state);
  useEffect(() => {
    layoutStateRef.current = layout.state;
  }, [layout.state]);
  const prevRunningCmdsRef = useRef<string[]>([]);

  useEffect(() => {
    const prev = prevRunningCmdsRef.current;
    prevRunningCmdsRef.current = runningCmdNames;
    if (runningCmdNames.length === 0) return;
    const prevSet = new Set(prev);
    const newlyRunning = runningCmdNames.find((name) => !prevSet.has(name));
    if (!newlyRunning) return;
    const cur = layoutStateRef.current;
    const logsGroup = findGroupByTab(cur.root, 'logs');
    if (logsGroup && logsGroup.activeTab !== 'logs') {
      setSelectedCmdName(newlyRunning);
      layout.activate(logsGroup.id, 'logs');
    } else if (logsGroup) {
      setSelectedCmdName(newlyRunning);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningCmdKey]);
}
