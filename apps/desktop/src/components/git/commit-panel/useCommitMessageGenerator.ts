import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import { ipc } from '@/lib/ipc';
import type { AiProvider, ServiceId } from '@/types';
import type { CommitPanelStore } from '@/components/git/useCommitPanelStore';

interface UseCommitMessageGeneratorOptions {
  serviceId: ServiceId;
  panel: CommitPanelStore;
  patch: CommitPanelStore['patch'];
  stagedCount: number;
  messageRef: RefObject<HTMLTextAreaElement>;
}

export function useCommitMessageGenerator({
  serviceId,
  panel,
  patch,
  stagedCount,
  messageRef,
}: UseCommitMessageGeneratorOptions) {
  const generateButtonRef = useRef<HTMLButtonElement>(null);

  const fetchProviders = useCallback(async (): Promise<AiProvider[]> => {
    try {
      const list = await ipc.listAiProviders();
      patch({ providers: list });
      return list;
    } catch {
      patch({ providers: [] });
      return [];
    }
  }, [patch]);

  const runGenerate = useCallback(
    async (provider: AiProvider) => {
      patch({ pickerOpen: false, generating: true, error: null });
      try {
        const hint = panel.message.trim() || null;
        const result = await ipc.aiGenerateCommitMessage({
          service_id: serviceId,
          provider_id: provider.id,
          hint,
        });
        const text = result.message.trim();
        patch({
          message: text,
          generationMeta: {
            provider: result.provider_name,
            model: result.model ?? null,
          },
        });
        window.setTimeout(() => {
          const textarea = messageRef.current;
          if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(text.length, text.length);
          }
        }, 0);
      } catch (err) {
        patch({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        patch({ generating: false });
      }
    },
    [serviceId, panel.message, patch, messageRef],
  );

  const generateMessage = useCallback(async () => {
    if (panel.generating) return;
    if (stagedCount === 0) {
      patch({ error: 'Stage some changes first — there is nothing to summarise.' });
      return;
    }

    const list = panel.providers ?? (await fetchProviders());
    if (list.length === 0) {
      patch({
        error:
          'No AI providers configured. Open Settings → AI to add one before generating commit messages.',
      });
      return;
    }
    if (list.length === 1) {
      void runGenerate(list[0]!);
      return;
    }

    void fetchProviders();
    patch({ pickerOpen: true });
  }, [panel.generating, panel.providers, stagedCount, fetchProviders, patch, runGenerate]);

  return { generateButtonRef, generateMessage, runGenerate };
}
