import { useEffect, useRef, useState } from 'react';
import type { AgentSnapshot } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import { mergeAgentSnapshot } from './agentSnapshotMerge';

export function useAgentSnapshot(id: string, visible = true) {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<{ id: string; revision: number } | null>(null);
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let busy = false;
    const refresh = async () => {
      if (
        busy ||
        (loaded.current?.id === id &&
          loaded.current.revision === useAgentStore.getState().sessions[id]?.revision)
      )
        return;
      busy = true;
      try {
        const result = await ipc.agentSnapshot(id);
        if (!disposed) {
          loaded.current = { id, revision: result.session.revision };
          setSnapshot((previous) => mergeAgentSnapshot(previous, result));
          useAgentStore.getState().merge(result.session);
          setError(null);
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 300);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [id, visible]);
  const loadOlder = async () => {
    if (!snapshot?.before) return;
    try {
      const result = await ipc.agentSnapshot(id, snapshot.before);
      setSnapshot((previous) => {
        if (!previous || previous.session.id !== result.session.id) return previous;
        const existingIds = new Set(previous.items.map((item) => item.id));
        return {
          ...previous,
          before: result.before,
          items: [...result.items.filter((item) => !existingIds.has(item.id)), ...previous.items],
        };
      });
    } catch (e) {
      setError(String(e));
    }
  };
  return { snapshot, error, loadOlder };
}
