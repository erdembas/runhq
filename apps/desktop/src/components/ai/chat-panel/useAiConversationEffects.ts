import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { AiChatProvider } from './aiChatProviders';
import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { ipc } from '@/lib/ipc';
import { useAppStore, type AiActionHook, type AiDraft } from '@/store/useAppStore';
import type { Conversation } from '@/types';
import type { Turn } from '../chatPanelTypes';
import { canUseChatProvider } from './aiChatProviders';
import { configuredAiProvider } from '@/lib/ai/aiPreferences';

type SendRef = RefObject<
  ((overrideText?: string, providerOverride?: AiChatProvider) => Promise<void>) | null
>;

interface Args {
  actionHookByConvRef: MutableRefObject<Map<string, AiActionHook>>;
  activeConversationId: string | null;
  aiDraft: AiDraft | null;
  clearAiDraft: () => void;
  consumedDraftIdRef: MutableRefObject<string | null>;
  loadedConversationIdRef: MutableRefObject<string | null>;
  pendingAutoSendPromptRef: MutableRefObject<string | null>;
  pendingAutoSendRef: MutableRefObject<boolean>;
  providers: AiChatProvider[];
  providersLoaded: boolean;
  sendRef: SendRef;
  setAwaitingAutoSend: (value: boolean) => void;
  setInput: (value: string) => void;
  setPickerOpen: (value: boolean) => void;
  setProvider: (provider: AiChatProvider) => void;
  setProviderError: (value: string | null) => void;
  setProviders: Dispatch<SetStateAction<AiChatProvider[]>>;
  setTurnsForConv: (convId: string, updater: Turn[] | ((prev: Turn[]) => Turn[])) => void;
  surfaceContextByConvRef: MutableRefObject<Map<string, string>>;
  turnFromMessage: (message: Conversation['messages'][number]) => Turn;
  turnsByConv: Map<string, Turn[]>;
}

export function useAiConversationEffects(args: Args) {
  useHydrateConversation(args);
  useConsumeDraft(args);
}

function useHydrateConversation({
  activeConversationId,
  loadedConversationIdRef,
  setProviderError,
  setTurnsForConv,
  turnFromMessage,
  turnsByConv,
}: Args) {
  useEffect(() => {
    if (loadedConversationIdRef.current === activeConversationId) return;
    if (activeConversationId && turnsByConv.has(activeConversationId)) {
      loadedConversationIdRef.current = activeConversationId;
      return;
    }
    loadedConversationIdRef.current = activeConversationId;
    if (!activeConversationId) return;
    const pendingDraft = useAppStore.getState().aiDraft;
    if (pendingDraft && pendingDraft.conversationId === activeConversationId) {
      setTurnsForConv(activeConversationId, []);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const conv = await ipc.getConversation(activeConversationId);
        if (!cancelled) setTurnsForConv(activeConversationId, conv.messages.map(turnFromMessage));
      } catch (e) {
        if (!cancelled) {
          console.error('Failed to load conversation:', e);
          setProviderError(
            i18n.t("Couldn't load conversation: {value1}", {
              value1: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeConversationId,
    loadedConversationIdRef,
    setProviderError,
    setTurnsForConv,
    turnFromMessage,
    turnsByConv,
  ]);
}

function useConsumeDraft({
  actionHookByConvRef,
  activeConversationId,
  aiDraft,
  clearAiDraft,
  consumedDraftIdRef,
  pendingAutoSendPromptRef,
  pendingAutoSendRef,
  providers,
  providersLoaded,
  sendRef,
  setAwaitingAutoSend,
  setInput,
  setPickerOpen,
  setProvider,
  setProviderError,
  surfaceContextByConvRef,
}: Args) {
  useEffect(() => {
    if (!aiDraft) return;
    if (aiDraft.conversationId !== activeConversationId) return;
    if (consumedDraftIdRef.current === aiDraft.conversationId) return;
    if (!providersLoaded) return;
    consumedDraftIdRef.current = aiDraft.conversationId;

    if (aiDraft.contextSystemMessage) {
      surfaceContextByConvRef.current.set(aiDraft.conversationId, aiDraft.contextSystemMessage);
    } else {
      surfaceContextByConvRef.current.delete(aiDraft.conversationId);
    }
    if (aiDraft.actionHook)
      actionHookByConvRef.current.set(aiDraft.conversationId, aiDraft.actionHook);
    else actionHookByConvRef.current.delete(aiDraft.conversationId);
    if (aiDraft.draftPrompt) setInput(aiDraft.draftPrompt);

    const shouldAutoSend = aiDraft.autoSend === true;
    const forcedProviderId = aiDraft.forcedProviderId ?? null;
    const prompt = aiDraft.draftPrompt;
    const forcedModel = aiDraft.forcedModel;
    const forcedSettings = aiDraft.forcedSettings;
    const origin = aiDraft.origin ?? 'free';
    clearAiDraft();
    const availableProviders = providers.filter(canUseChatProvider);
    if (availableProviders.length === 0) return;

    try {
      const selected = forcedProviderId
        ? availableProviders.find((entry) => entry.id === forcedProviderId)
        : configuredAiProvider(providers, origin);
      if (forcedProviderId && !selected) {
        throw new Error(
          i18n.t(
            'The AI provider selected for this use case is unavailable. Update its selection in Settings → AI providers.',
          ),
        );
      }
      if (selected) {
        const forced = forcedSettings
          ? { ...selected, ...forcedSettings }
          : forcedModel !== undefined
            ? { ...selected, model: forcedModel }
            : selected;
        setProvider(forced);
        if (shouldAutoSend) void sendRef.current?.(prompt, forced);
        return;
      }
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (!shouldAutoSend) return;
    if (availableProviders.length === 1) {
      void sendRef.current?.(prompt, availableProviders[0]);
      return;
    }
    pendingAutoSendRef.current = true;
    pendingAutoSendPromptRef.current = prompt ?? null;
    setAwaitingAutoSend(true);
    setPickerOpen(true);
  }, [
    actionHookByConvRef,
    activeConversationId,
    aiDraft,
    clearAiDraft,
    consumedDraftIdRef,
    pendingAutoSendPromptRef,
    pendingAutoSendRef,
    providers,
    providersLoaded,
    sendRef,
    setAwaitingAutoSend,
    setInput,
    setPickerOpen,
    setProvider,
    setProviderError,
    surfaceContextByConvRef,
  ]);
}
