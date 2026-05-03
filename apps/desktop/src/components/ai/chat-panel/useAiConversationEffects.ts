import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { ipc } from '@/lib/ipc';
import { useAppStore, type AiActionHook, type AiDraft } from '@/store/useAppStore';
import type { AiProvider, Conversation } from '@/types';
import type { Turn } from '../chatPanelTypes';

type SendRef = RefObject<
  ((overrideText?: string, providerOverride?: AiProvider) => Promise<void>) | null
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
  providers: AiProvider[];
  providersLoaded: boolean;
  sendRef: SendRef;
  setAwaitingAutoSend: (value: boolean) => void;
  setInput: (value: string) => void;
  setPickerOpen: (value: boolean) => void;
  setProvider: (provider: AiProvider) => void;
  setProviderError: (value: string | null) => void;
  setProviders: Dispatch<SetStateAction<AiProvider[]>>;
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
            `Couldn't load conversation: ${e instanceof Error ? e.message : String(e)}`,
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
  setProviders,
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
    clearAiDraft();
    if (!shouldAutoSend || providers.length === 0) return;

    if (forcedProviderId) {
      const forced = providers.find((p) => p.id === forcedProviderId);
      if (forced) {
        setProvider(forced);
        void ipc
          .setDefaultAiProvider(forced.id)
          .then(() =>
            setProviders((prev) => prev.map((x) => ({ ...x, default: x.id === forced.id }))),
          )
          .catch(() => {});
        void sendRef.current?.(prompt, forced);
        return;
      }
    }

    if (providers.length === 1) {
      void sendRef.current?.(prompt);
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
    setProviders,
    surfaceContextByConvRef,
  ]);
}
