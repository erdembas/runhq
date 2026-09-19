import { useEffect } from 'react';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import type { AgentContextEntry } from './agentLibraryModel';

const noEntries: AgentContextEntry[] = [];
export function useAgentContext(draftKey: string, projectId: string) {
  const key = `context:${draftKey}`;
  const value = useAgentLibraryStore((s) => s.records[key]?.value);
  const entries = Array.isArray(value) ? (value as AgentContextEntry[]) : noEntries;
  const ready = useAgentLibraryStore((s) => s.ready);
  useEffect(() => {
    if (!ready) void useAgentLibraryStore.getState().refresh();
  }, [ready]);
  return {
    entries,
    ready,
    set: (next: AgentContextEntry[]) =>
      useAgentLibraryStore.getState().save(key, next.length ? next : null),
    clear: () => useAgentLibraryStore.getState().save(key, null),
    make: (name: string, content: string, source: string): AgentContextEntry => ({
      id: crypto.randomUUID(),
      name,
      content,
      source,
      projectId,
      capturedAt: Date.now(),
    }),
  };
}
