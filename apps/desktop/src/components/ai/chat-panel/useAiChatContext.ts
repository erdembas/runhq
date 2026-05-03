import { useEffect, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { ipc } from '@/lib/ipc';
import { buildProjectNotesContext } from '@/lib/ai/notesPayload';
import type { ServiceDef } from '@/types';
import type { Turn } from '../chatPanelTypes';

interface Args {
  getSurfaceContext: () => string | null;
  input: string;
  projectNotesContext: string | null;
  selectedService: ServiceDef | null | undefined;
  setProjectNotesContext: (value: string | null) => void;
  setTokenCount: (value: number | null) => void;
  tokenSeqRef: MutableRefObject<number>;
  turns: Turn[];
}

export function useAiChatContext({
  getSurfaceContext,
  input,
  projectNotesContext,
  selectedService,
  setProjectNotesContext,
  setTokenCount,
  tokenSeqRef,
  turns,
}: Args) {
  const contextChips = useMemo(() => {
    const chips: { id: string; label: string }[] = [];
    if (selectedService) chips.push({ id: 'service', label: `service: ${selectedService.name}` });
    return chips;
  }, [selectedService]);

  useEffect(() => {
    setProjectNotesContext(null);
    if (!selectedService) return;
    let cancelled = false;
    buildProjectNotesContext(selectedService.id)
      .then((ctx) => {
        if (!cancelled) setProjectNotesContext(ctx);
      })
      .catch((err) => {
        if (!cancelled) console.warn('[AiChatPanel] failed to read project notes', { err });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedService, setProjectNotesContext]);

  const contextSystemMessage = useMemo(() => {
    if (!selectedService) return null;
    const lines: string[] = ['User is currently looking at this RunHQ context:'];
    lines.push(`- Active service: \`${selectedService.name}\` (cwd: ${selectedService.cwd})`);
    if (selectedService.tags?.length) lines.push(`  tags: ${selectedService.tags.join(', ')}`);
    if (projectNotesContext) lines.push('', projectNotesContext);
    return lines.join('\n');
  }, [selectedService, projectNotesContext]);

  useEffect(() => {
    const seq = ++tokenSeqRef.current;
    const handle = window.setTimeout(() => {
      const texts: string[] = [];
      if (contextSystemMessage) texts.push(contextSystemMessage);
      const surfaceCtx = getSurfaceContext();
      if (surfaceCtx) texts.push(surfaceCtx);
      for (const t of turns) if (t.content) texts.push(t.content);
      if (input) texts.push(input);
      if (texts.length === 0) {
        setTokenCount(0);
        return;
      }
      void ipc
        .aiCountTokens(texts)
        .then((n) => {
          if (tokenSeqRef.current === seq) setTokenCount(n);
        })
        .catch(() => {});
    }, 120);
    return () => window.clearTimeout(handle);
  }, [contextSystemMessage, getSurfaceContext, input, setTokenCount, tokenSeqRef, turns]);

  return { contextChips, contextSystemMessage };
}
