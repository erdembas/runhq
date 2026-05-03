import { useMemo, useRef } from 'react';
import type { AiProvider } from '@/types';
import { HistoryDrawer } from './HistoryDrawer';
import { ChatTabs } from './ChatTabs';
import { AiChatComposer } from './chat-panel/AiChatComposer';
import { AiChatMessageList } from './chat-panel/AiChatMessageList';
import { AiChatPanelHeader } from './chat-panel/AiChatPanelHeader';
import { panelClassName } from './chat-panel/aiChatPanelLayout';
import { useAiChatState } from './chat-panel/useAiChatState';
import { useAiConversationEffects } from './chat-panel/useAiConversationEffects';
import { useAiChatContext } from './chat-panel/useAiChatContext';
import { useAiChatSending } from './chat-panel/useAiChatSending';
import { useAiChatTabs } from './chat-panel/useAiChatTabs';
import { useAiPanelEffects } from './chat-panel/useAiPanelEffects';
import { useAiProviderPicker } from './chat-panel/useAiProviderPicker';
import { useAiStreamRunner } from './chat-panel/useAiStreamRunner';

interface AiChatPanelProps {
  /**
   * Drawer mode (legacy): the panel positions itself as a fixed
   * right-edge slide-in. `open`/`onClose` control mount + dismiss.
   *
   * Inline mode (new): the panel is rendered inside the
   * `<RightSidePanel />` shell which owns visibility via the right
   * activity rail. In this mode `open`/`onClose` are ignored —
   * presence in the tree means "render". Pass `variant="inline"`.
   */
  variant?: 'drawer' | 'inline';
  open?: boolean;
  onClose?: () => void;
}

/**
 * Right-side slide-in chat drawer.
 *
 * Multi-turn conversation backed by the streaming `ai_chat_completion`
 * IPC. Lives entirely in component memory — closing the panel keeps
 * the conversation, "New chat" wipes it. Persisting across reloads
 * is a future tidy: it requires a per-conversation store, retention
 * limits, and a cost-aware redaction step before we treat any prior
 * turn as "context worth re-sending".
 *
 * Keyboard contract:
 *   - Esc: close
 *   - Enter: send (Shift+Enter for newline)
 *   - The trigger shortcut (Cmd/Ctrl+L) is owned by the parent.
 *
 * The panel uses overlay-free positioning (right-side z-index above
 * the dashboard, but no scrim) so the user can keep glancing at logs
 * / dashboards while typing — that's the whole point of "ask while
 * working" vs a modal interruption.
 */
export function AiChatPanel({ variant = 'drawer', open = true, onClose }: AiChatPanelProps) {
  // Inline mode is *always* "open" — the right activity rail decides
  // when this component is mounted. Collapse to a single boolean
  // here so the rest of the file doesn't need to special-case the
  // variant on every effect.
  const isOpen = variant === 'inline' ? true : open;
  // Memoised so the Esc-listener effect's dep array stays stable
  // across renders even when no `onClose` is wired (inline mode).
  const closePanel = useMemo(() => onClose ?? (() => {}), [onClose]);
  const {
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
  } = useAiChatState();
  const sendRef = useRef<
    ((overrideText?: string, providerOverride?: AiProvider) => Promise<void>) | null
  >(null);

  useAiConversationEffects({
    actionHookByConvRef,
    activeConversationId,
    aiDraft,
    clearAiDraft,
    consumedDraftIdRef,
    loadedConversationIdRef,
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
    setProviders,
    setTurnsForConv,
    surfaceContextByConvRef,
    turnFromMessage,
    turnsByConv,
  });

  const { cancel, cancelFor, persistUserMessage, runStream } = useAiStreamRunner({
    activeConversationId,
    bumpRequestId,
    getPersistedSet,
    inFlightConvsRef,
    provider,
    requestIdsRef,
    runStreamRef,
    setProviderError,
    setTurnsForConv,
    startedAtRef,
  });

  const { openAiSettingsFromPicker, selectProvider } = useAiProviderPicker({
    isOpen,
    pendingAutoSendPromptRef,
    pendingAutoSendRef,
    pickerOpen,
    pickerRef,
    sendRef,
    setAwaitingAutoSend,
    setPickerOpen,
    setProvider,
    setProviderError,
    setProviders,
    setProvidersLoaded,
  });

  const activeTabTitle = useAiPanelEffects({
    closePanel,
    input,
    inputRef,
    isOpen,
    scrollRef,
    turns,
    variant,
  });
  const { contextChips, contextSystemMessage } = useAiChatContext({
    getSurfaceContext,
    input,
    projectNotesContext,
    selectedService,
    setProjectNotesContext,
    setTokenCount,
    tokenSeqRef,
    turns,
  });

  const {
    closeAllFromBar,
    closeOthersFromBar,
    closeTabFromBar,
    closeToRightFromBar,
    isStreaming,
    newChat,
    selectTab,
    streamingTabIds,
  } = useAiChatTabs({
    actionHookByConvRef,
    activeConversationId,
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
  });

  const { continueTruncated, send } = useAiChatSending({
    activeConversationId,
    cancel,
    contextSystemMessage,
    getActionHook,
    getSurfaceContext,
    input,
    loadedConversationIdRef,
    persistUserMessage,
    provider,
    runStream,
    sendRef,
    setActiveConversation,
    setInput,
    setProviderError,
    setTurns,
    setTurnsForConv,
    turns,
  });

  if (!isOpen) return null;

  // Drawer = legacy fixed-position slide-in (used when the right
  // activity rail isn't part of the layout). Inline = mounted inside
  // the rail-driven shell which already provides positioning, border,
  // and (most importantly) the close affordance via the active icon.
  const isInline = variant === 'inline';

  return (
    <div
      className={panelClassName(isInline)}
      role={isInline ? undefined : 'dialog'}
      aria-label={isInline ? undefined : 'AI Chat'}
    >
      <AiChatPanelHeader
        activeConversationId={activeConversationId}
        isInline={isInline}
        isStreaming={isStreaming}
        openTabs={openTabs}
        providerError={providerError}
        turnsLength={turns.length}
        onClose={closePanel}
        onHistory={() => setHistoryOpen(true)}
        onNewChat={newChat}
      />
      <ChatTabs
        openTabs={openTabs}
        activeConversationId={activeConversationId}
        activeTitleOverride={activeTabTitle}
        activeStreaming={isStreaming}
        streamingTabIds={streamingTabIds}
        onSelect={selectTab}
        onClose={closeTabFromBar}
        onCloseOthers={closeOthersFromBar}
        onCloseToRight={closeToRightFromBar}
        onCloseAll={closeAllFromBar}
        onNew={newChat}
        // Disable "+" when the active chat is already a fresh empty
        // one: spawning another would be a no-op and just confuse
        // the user with an "I clicked but nothing happened" state.
        newDisabled={turns.length === 0 && !activeConversationId && !isStreaming}
      />
      <AiChatMessageList turns={turns} scrollRef={scrollRef} onContinue={continueTruncated} />
      <AiChatComposer
        awaitingAutoSend={awaitingAutoSend}
        contextChips={contextChips}
        input={input}
        inputRef={inputRef}
        isInline={isInline}
        isStreaming={isStreaming}
        pickerOpen={pickerOpen}
        pickerRef={pickerRef}
        provider={provider}
        providers={providers}
        selectedService={selectedService ?? null}
        tokenCount={tokenCount}
        turnsLength={turns.length}
        onCancel={cancel}
        onInput={setInput}
        onManageModels={openAiSettingsFromPicker}
        onPickerOpenChange={setPickerOpen}
        onSelectProvider={selectProvider}
        onSend={() => void send()}
      />
      <HistoryDrawer
        open={historyOpen}
        activeConversationId={activeConversationId}
        onClose={() => setHistoryOpen(false)}
        onSelect={(id) => {
          setHistoryOpen(false);
          if (id !== activeConversationId) {
            // cancel any in-flight stream attached to the previous
            // conversation before swapping rosters; otherwise the
            // pending tokens would land on whichever turn id the
            // new conversation happens to have first.
            cancel();
            setActiveConversation(id);
          }
        }}
      />
    </div>
  );
}
