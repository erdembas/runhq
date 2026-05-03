import { useCallback, useMemo } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { AiActionHook } from '@/store/useAppStore';
import type { Turn } from '../chatPanelTypes';

interface Args {
  actionHookByConvRef: MutableRefObject<Map<string, AiActionHook>>;
  activeConversationId: string | null;
  cancelFor: (id: string | null) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (keepId: string) => void;
  closeTab: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  consumedDraftIdRef: MutableRefObject<string | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  openTabs: string[];
  persistedTurnIdsByConvRef: MutableRefObject<Map<string, Set<string>>>;
  setActiveConversation: (id: string | null) => void;
  setInput: (value: string) => void;
  setTurnsByConv: Dispatch<SetStateAction<Map<string, Turn[]>>>;
  surfaceContextByConvRef: MutableRefObject<Map<string, string>>;
  turns: Turn[];
  turnsByConv: Map<string, Turn[]>;
}

export function useAiChatTabs({
  activeConversationId,
  actionHookByConvRef,
  cancelFor,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  consumedDraftIdRef,
  inputRef,
  openTabs,
  persistedTurnIdsByConvRef,
  setActiveConversation,
  setInput,
  setTurnsByConv,
  surfaceContextByConvRef,
  turns,
  turnsByConv,
}: Args) {
  const newChat = useCallback(() => {
    setActiveConversation(null);
    consumedDraftIdRef.current = null;
    setInput('');
    inputRef.current?.focus();
  }, [consumedDraftIdRef, inputRef, setActiveConversation, setInput]);

  const selectTab = useCallback(
    (id: string) => {
      if (id !== activeConversationId) setActiveConversation(id);
    },
    [activeConversationId, setActiveConversation],
  );

  const purgeConvState = useCallback(
    (id: string) => {
      cancelFor(id);
      surfaceContextByConvRef.current.delete(id);
      actionHookByConvRef.current.delete(id);
      persistedTurnIdsByConvRef.current.delete(id);
      setTurnsByConv((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
    [
      actionHookByConvRef,
      cancelFor,
      persistedTurnIdsByConvRef,
      setTurnsByConv,
      surfaceContextByConvRef,
    ],
  );

  const closeTabFromBar = useCallback(
    (id: string) => {
      purgeConvState(id);
      closeTab(id);
    },
    [purgeConvState, closeTab],
  );

  const closeOthersFromBar = useCallback(
    (keepId: string) => {
      for (const id of openTabs) if (id !== keepId) purgeConvState(id);
      closeOtherTabs(keepId);
    },
    [openTabs, purgeConvState, closeOtherTabs],
  );

  const closeToRightFromBar = useCallback(
    (id: string) => {
      const idx = openTabs.indexOf(id);
      if (idx < 0) return;
      for (let i = idx + 1; i < openTabs.length; i += 1) {
        const closingId = openTabs[i];
        if (closingId) purgeConvState(closingId);
      }
      closeTabsToRight(id);
    },
    [openTabs, purgeConvState, closeTabsToRight],
  );

  const closeAllFromBar = useCallback(() => {
    for (const id of openTabs) purgeConvState(id);
    closeAllTabs();
  }, [openTabs, purgeConvState, closeAllTabs]);

  const isStreaming = turns.some((t) => t.streaming);
  const streamingTabIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of openTabs) {
      const tabTurns = turnsByConv.get(id);
      if (tabTurns?.some((t) => t.streaming)) ids.add(id);
    }
    return ids;
  }, [openTabs, turnsByConv]);

  return {
    closeAllFromBar,
    closeOthersFromBar,
    closeTabFromBar,
    closeToRightFromBar,
    isStreaming,
    newChat,
    selectTab,
    streamingTabIds,
  };
}
