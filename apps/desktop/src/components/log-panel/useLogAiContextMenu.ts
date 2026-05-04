import { useCallback } from 'react';
import { buildLogChatPayload } from '@/lib/ai/logPayload';
import { inferRuntimeFromCmds, runtimeFromTags } from '@/lib/runtimes';
import { useAppStore } from '@/store/useAppStore';
import type { ServiceDef } from '@/types';
import { EMPTY_LOGS, filterLogLines } from './model';
import type { LogsByCommand } from './useCommandLogs';

interface UseLogAiContextMenuArgs {
  allLogsByCommand: LogsByCommand;
  filter: string;
  service: ServiceDef | null;
}

export function useLogAiContextMenu({
  allLogsByCommand,
  filter,
  service,
}: UseLogAiContextMenuArgs) {
  const openAiChat = useAppStore((s) => s.openAiChat);

  return useCallback(
    (commandName: string, index: number) => {
      const filtered = filterLogLines(allLogsByCommand[commandName] ?? EMPTY_LOGS, filter);
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
    [allLogsByCommand, filter, service, openAiChat],
  );
}
