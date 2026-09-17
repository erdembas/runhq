import { useCallback } from 'react';
import { buildLogChatPayload } from '@/lib/ai/logPayload';
import { inferRuntimeFromCmds, runtimeFromTags } from '@/lib/runtimes';
import { useAppStore } from '@/store/useAppStore';
import type { LogLine, ServiceDef } from '@/types';

interface UseLogAiContextMenuArgs {
  service: ServiceDef | null;
}

export function useLogAiContextMenu({ service }: UseLogAiContextMenuArgs) {
  const openAiChat = useAppStore((s) => s.openAiChat);

  return useCallback(
    (filtered: LogLine[], index: number) => {
      const target = filtered[index];
      if (!target) return;

      const start = Math.max(0, index - 30);
      const payload = buildLogChatPayload({
        line: target.text,
        contextLines: filtered.slice(start, index + 1).map((line) => line.text),
        runtime: service
          ? (runtimeFromTags(service.tags) ?? inferRuntimeFromCmds(service.cmds))
          : null,
        serviceName: service?.name ?? null,
      });

      void openAiChat({
        origin: 'log',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
        autoSend: true,
      });
    },
    [service, openAiChat],
  );
}
