import { AlertTriangle, History, Plus, Sparkles, X } from 'lucide-react';

interface Props {
  activeConversationId: string | null;
  isInline: boolean;
  isStreaming: boolean;
  openTabs: string[];
  providerError: string | null;
  turnsLength: number;
  onClose: () => void;
  onHistory: () => void;
  onNewChat: () => void;
}

export function AiChatPanelHeader({
  activeConversationId,
  isInline,
  isStreaming,
  openTabs,
  providerError,
  turnsLength,
  onClose,
  onHistory,
  onNewChat,
}: Props) {
  const newDisabled = turnsLength === 0 && !activeConversationId && !isStreaming;

  return (
    <>
      <header className="border-border flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="text-accent h-3.5 w-3.5" />
        <div className="text-fg text-[12px] font-semibold">AI Chat</div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onHistory}
          title="Chat history"
          className="text-fg-dim hover:bg-fg/10 hover:text-fg flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] transition"
        >
          <History className="h-3 w-3" />
          History
        </button>
        {openTabs.length === 0 && (
          <button
            type="button"
            onClick={onNewChat}
            disabled={newDisabled}
            title="New chat"
            className="text-fg-dim hover:bg-fg/10 hover:text-fg flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        )}
        {!isInline && (
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="text-fg-dim hover:bg-fg/10 hover:text-fg flex h-6 w-6 items-center justify-center rounded transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>
      {providerError && (
        <div className="border-status-error/30 bg-status-error/5 text-status-error flex items-center gap-1.5 border-b px-3 py-2 text-[11px]">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="flex-1">{providerError}</span>
        </div>
      )}
    </>
  );
}
