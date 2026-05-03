import { useCallback, useMemo, useRef, useState } from 'react';
import type { AiActionHook } from '@/store/useAppStore';
import { useAppStore } from '@/store/useAppStore';
import type { AiProvider, ChatMessage, ConversationMessage } from '@/types';
import type { Turn } from '../chatPanelTypes';

export type RunStreamFn = (args: {
  targetTurnId: string;
  targetConvId: string;
  history: ChatMessage[];
  appendOnly: boolean;
  retryAttempt?: number;
  providerOverride?: AiProvider;
}) => Promise<void>;

export function useAiChatState() {
  const [turnsByConv, setTurnsByConv] = useState<Map<string, Turn[]>>(() => new Map());
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [awaitingAutoSend, setAwaitingAutoSend] = useState(false);
  const [projectNotesContext, setProjectNotesContext] = useState<string | null>(null);
  const [tokenCount, setTokenCount] = useState<number | null>(null);

  const surfaceContextByConvRef = useRef<Map<string, string>>(new Map());
  const actionHookByConvRef = useRef<Map<string, AiActionHook>>(new Map());
  const persistedTurnIdsByConvRef = useRef<Map<string, Set<string>>>(new Map());
  const pendingAutoSendRef = useRef(false);
  const pendingAutoSendPromptRef = useRef<string | null>(null);
  const requestIdsRef = useRef<Map<string, number>>(new Map());
  const inFlightConvsRef = useRef<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const runStreamRef = useRef<RunStreamFn | null>(null);
  const loadedConversationIdRef = useRef<string | null>(null);
  const consumedDraftIdRef = useRef<string | null>(null);
  const tokenSeqRef = useRef(0);

  const selectedService = useAppStore((s) =>
    s.selectedServiceId ? s.services.find((x) => x.id === s.selectedServiceId) : null,
  );
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const setActiveConversation = useAppStore((s) => s.setActiveConversation);
  const openTabs = useAppStore((s) => s.openTabs);
  const closeTab = useAppStore((s) => s.closeTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const closeAllTabs = useAppStore((s) => s.closeAllTabs);
  const aiDraft = useAppStore((s) => s.aiDraft);
  const clearAiDraft = useAppStore((s) => s.clearAiDraft);

  const turns = useMemo<Turn[]>(
    () => (activeConversationId ? (turnsByConv.get(activeConversationId) ?? []) : []),
    [turnsByConv, activeConversationId],
  );

  const setTurnsForConv = useCallback(
    (convId: string, updater: Turn[] | ((prev: Turn[]) => Turn[])) => {
      setTurnsByConv((prev) => {
        const cur = prev.get(convId) ?? [];
        const nextTurns = typeof updater === 'function' ? updater(cur) : updater;
        if (nextTurns === cur) return prev;
        const next = new Map(prev);
        next.set(convId, nextTurns);
        return next;
      });
    },
    [],
  );

  const setTurns = useCallback(
    (updater: Turn[] | ((prev: Turn[]) => Turn[])) => {
      if (activeConversationId) setTurnsForConv(activeConversationId, updater);
    },
    [activeConversationId, setTurnsForConv],
  );

  const bumpRequestId = useCallback((convId: string): number => {
    const next = (requestIdsRef.current.get(convId) ?? 0) + 1;
    requestIdsRef.current.set(convId, next);
    return next;
  }, []);

  const getPersistedSet = useCallback((convId: string): Set<string> => {
    let set = persistedTurnIdsByConvRef.current.get(convId);
    if (!set) {
      set = new Set();
      persistedTurnIdsByConvRef.current.set(convId, set);
    }
    return set;
  }, []);

  const getSurfaceContext = useCallback(
    (convId?: string | null): string | null => {
      const id = convId ?? activeConversationId;
      return id ? (surfaceContextByConvRef.current.get(id) ?? null) : null;
    },
    [activeConversationId],
  );

  const getActionHook = useCallback(
    (convId?: string | null): AiActionHook | null => {
      const id = convId ?? activeConversationId;
      return id ? (actionHookByConvRef.current.get(id) ?? null) : null;
    },
    [activeConversationId],
  );

  const turnFromMessage = useCallback((m: ConversationMessage): Turn => {
    const stableId = m.client_id ?? `${m.role === 'user' ? 'u' : 'a'}-loaded-${m.id}`;
    return {
      id: stableId,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning ?? undefined,
      reasoningStartedAtMs: m.reasoning ? m.created_at_ms : undefined,
      reasoningEndedAtMs: m.reasoning ? m.created_at_ms : undefined,
      streaming: false,
      error: m.error ?? undefined,
      finishReason: m.finish_reason ?? null,
      partial: m.partial,
      providerName: m.provider_name ?? undefined,
      modelName: m.model_name ?? undefined,
    };
  }, []);

  return {
    actionHookByConvRef,
    activeConversationId,
    aiDraft,
    awaitingAutoSend,
    bumpRequestId,
    clearAiDraft,
    closeAllTabs,
    closeOtherTabs,
    closeTab,
    closeTabsToRight,
    consumedDraftIdRef,
    getActionHook,
    getPersistedSet,
    getSurfaceContext,
    historyOpen,
    inFlightConvsRef,
    input,
    inputRef,
    loadedConversationIdRef,
    openTabs,
    pendingAutoSendPromptRef,
    pendingAutoSendRef,
    persistedTurnIdsByConvRef,
    pickerOpen,
    pickerRef,
    projectNotesContext,
    provider,
    providerError,
    providers,
    providersLoaded,
    requestIdsRef,
    runStreamRef,
    scrollRef,
    selectedService,
    setActiveConversation,
    setAwaitingAutoSend,
    setHistoryOpen,
    setInput,
    setPickerOpen,
    setProjectNotesContext,
    setProvider,
    setProviderError,
    setProviders,
    setProvidersLoaded,
    setTokenCount,
    setTurns,
    setTurnsByConv,
    setTurnsForConv,
    startedAtRef,
    surfaceContextByConvRef,
    tokenCount,
    tokenSeqRef,
    turnFromMessage,
    turns,
    turnsByConv,
  };
}
