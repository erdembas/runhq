import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AgentRequestCard } from '@runhq/cockpit-ui';
import { ipc } from '@/lib/ipc';
import type { AgentSession, ServiceId } from '@/types';
import type { CommitPanelStore } from '@/components/git/useCommitPanelStore';
import { useAppStore } from '@/store/useAppStore';
import {
  canUseChatProvider,
  isCliChatProvider,
  type AiChatProvider,
} from '@/components/ai/chat-panel/aiChatProviders';
import { runCliChat } from '@/components/ai/chat-panel/cliChatStream';
import { configuredAiProvider } from '@/lib/ai/aiPreferences';
import { loadAiProviders } from '@/lib/ai/loadAiProviders';
import { extractCommitMessage } from '@/lib/ai/commitMessage';

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
  i18n.useLocale();
  const generateButtonRef = useRef<HTMLButtonElement>(null);
  const runRef = useRef<InstanceType<typeof globalThis.AbortController> | null>(null);
  const [cliSession, setCliSession] = useState<AgentSession | null>(null);
  useEffect(
    () => () => {
      runRef.current?.abort();
    },
    [serviceId],
  );

  const runGenerate = useCallback(
    async (provider: AiChatProvider) => {
      if (runRef.current) return;
      const controller = new globalThis.AbortController();
      runRef.current = controller;
      patch({ pickerOpen: false, generating: true, error: null });
      const originalMessage = panel.message;
      try {
        const hint = originalMessage.trim() || null;
        let text: string;
        let model = provider.model;
        if (isCliChatProvider(provider)) {
          const service = useAppStore.getState().services.find((entry) => entry.id === serviceId);
          if (!service) throw new Error(i18n.t('Service not found'));
          const context = await ipc.aiCommitChatContext({ service_id: serviceId, hint });
          if (!context.diff.trim())
            throw new Error(i18n.t('Stage some changes first — there is nothing to summarise.'));
          const project = await ipc.agentAddProject(service.name, service.cwd);
          const result = await runCliChat({
            client: ipc,
            backend: provider.cli,
            effort: provider.effort,
            mode: provider.mode,
            agent: provider.agent,
            model,
            projectId: project.id,
            history: context.messages,
            signal: controller.signal,
            onSnapshot: (snapshot) => setCliSession(snapshot.session),
            onStopError: (error) => patch({ error }),
          });
          if (!result || controller.signal.aborted) return;
          if (result.status !== 'completed') return;
          text = extractCommitMessage(result.content);
        } else {
          const result = await ipc.aiGenerateCommitMessage({
            service_id: serviceId,
            provider_id: provider.id,
            model,
            hint,
          });
          text = result.message.trim();
          model = result.model ?? model;
        }
        if (controller.signal.aborted) return;
        if (!text) throw new Error(i18n.t('No commit message was returned. Try generating again.'));
        // A draft edited while a request runs belongs to the user.
        patch((current) =>
          current.message === originalMessage
            ? {
                message: text,
                generationMeta: { provider: provider.name, model: model || null },
              }
            : {},
        );
        window.setTimeout(() => messageRef.current?.focus(), 0);
      } catch (error) {
        if (!controller.signal.aborted)
          patch({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (runRef.current === controller) {
          runRef.current = null;
          setCliSession(null);
          patch({ generating: false });
        }
      }
    },
    [serviceId, panel.message, patch, messageRef],
  );

  const generateMessage = useCallback(async () => {
    if (panel.generating || runRef.current) return;
    if (stagedCount === 0) {
      patch({ error: i18n.t('Stage some changes first — there is nothing to summarise.') });
      return;
    }
    try {
      const list = await loadAiProviders();
      const configured = configuredAiProvider(list, 'commit');
      const available = list.filter(canUseChatProvider);
      patch({ providers: available, error: null });
      if (configured || available.length === 1) {
        void runGenerate(configured ?? available[0]!);
      } else if (available.length === 0) {
        patch({
          error: i18n.t('Connect a CLI in Agent tools or add an API provider in Settings → AI.'),
        });
      } else {
        patch({ pickerOpen: true });
      }
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : String(error) });
    }
  }, [panel.generating, stagedCount, patch, runGenerate]);

  const generationControls = panel.generating ? (
    <div className="space-y-2">
      <button
        type="button"
        className="text-fg-dim hover:text-fg text-[11px]"
        onClick={() => runRef.current?.abort()}
      >
        {i18n.t('Cancel')}
      </button>
      {cliSession?.pending.map((request) => (
        <AgentRequestCard
          key={`${cliSession.id}:${request.id}`}
          request={request}
          disabled={cliSession.status === 'cancelling'}
          onOpenUrl={(url) => ipc.openUrl(url)}
          onAnswer={(value) => ipc.agentAnswer(cliSession.id, request.id, value)}
        />
      ))}
    </div>
  ) : null;

  return { generateButtonRef, generateMessage, runGenerate, generationControls };
}
