import { createPortal } from 'react-dom';
import type { Ref } from 'react';
import { BranchSection } from './BranchSection';
import { GitActionGrid } from './GitActionGrid';
import { GitErrorBanner } from './GitErrorBanner';
import { GitPopoverHeader } from './GitPopoverHeader';
import { GitStatusSummary } from './GitStatusSummary';
import { LastCommitCard } from './LastCommitCard';
import { RecentCommitsList } from './RecentCommitsList';
import {
  POPOVER_WIDTH,
  type BranchSectionState,
  type BranchTabKind,
  type BusyOp,
  type GitActionCallbacks,
  type GitPopoverPosition,
} from './types';
import type { CommitSummary, GitStatus } from '@/types';

interface GitStatusPopoverProps {
  git: GitStatus;
  position: GitPopoverPosition | null;
  busy: BusyOp | null;
  error: string | null;
  amending: boolean;
  amendMessage: string;
  copiedHash: boolean;
  olderCommits: CommitSummary[];
  recentExpanded: boolean;
  branchState: BranchSectionState;
  amendInputRef: Ref<HTMLTextAreaElement>;
  searchInputRef: Ref<HTMLInputElement>;
  newBranchInputRef: Ref<HTMLInputElement>;
  actions: GitActionCallbacks;
  onClose: () => void;
  onDismissError: () => void;
  onOpenDiff: () => void;
  onAmendMessageChange: (value: string) => void;
  onSubmitAmend: () => void;
  onCancelAmend: () => void;
  onCopyHash: (hash: string) => void;
  onStartAmend: (message: string) => void;
  onRequestUndo: () => void;
  onToggleRecent: () => void;
  onBranchSearchChange: (value: string) => void;
  onBranchTabChange: (tab: BranchTabKind) => void;
  onRequestCheckout: (branch: string) => void;
  onRequestDeleteBranch: (branch: string) => void;
  onStartCreating: () => void;
  onNewBranchChange: (value: string) => void;
  onSubmitNewBranch: () => void;
  onCancelCreate: () => void;
}

export function GitStatusPopover({
  git,
  position,
  busy,
  error,
  amending,
  amendMessage,
  copiedHash,
  olderCommits,
  recentExpanded,
  branchState,
  amendInputRef,
  searchInputRef,
  newBranchInputRef,
  actions,
  onClose,
  onDismissError,
  onOpenDiff,
  onAmendMessageChange,
  onSubmitAmend,
  onCancelAmend,
  onCopyHash,
  onStartAmend,
  onRequestUndo,
  onToggleRecent,
  onBranchSearchChange,
  onBranchTabChange,
  onRequestCheckout,
  onRequestDeleteBranch,
  onStartCreating,
  onNewBranchChange,
  onSubmitNewBranch,
  onCancelCreate,
}: GitStatusPopoverProps) {
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-9998 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="border-border bg-surface-raised rounded-app-lg animate-fade-in fixed z-9999 flex max-h-[calc(100vh-96px)] flex-col overflow-hidden border shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
        style={{
          width: POPOVER_WIDTH,
          ...(position ? { top: position.top, bottom: position.bottom, left: position.left } : {}),
        }}
        role="dialog"
      >
        <GitPopoverHeader upstream={git.upstream} />

        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2.5">
            <GitStatusSummary git={git} onOpenDiff={onOpenDiff} />
            <GitErrorBanner message={error} onDismiss={onDismissError} />
            <LastCommitCard
              lastCommit={git.last_commit}
              amending={amending}
              amendInputRef={amendInputRef}
              amendMessage={amendMessage}
              busy={busy}
              copiedHash={copiedHash}
              onAmendMessageChange={onAmendMessageChange}
              onSubmitAmend={onSubmitAmend}
              onCancelAmend={onCancelAmend}
              onCopyHash={onCopyHash}
              onStartAmend={onStartAmend}
              onRequestUndo={onRequestUndo}
            />
            <RecentCommitsList
              commits={olderCommits}
              expanded={recentExpanded}
              onToggle={onToggleRecent}
              onCopyHash={onCopyHash}
            />
            <GitActionGrid git={git} busy={busy} actions={actions} />
          </div>

          <BranchSection
            state={branchState}
            busy={busy}
            branch={git.branch}
            upstream={git.upstream}
            searchInputRef={searchInputRef}
            newBranchInputRef={newBranchInputRef}
            onBranchSearchChange={onBranchSearchChange}
            onBranchTabChange={onBranchTabChange}
            onRequestCheckout={onRequestCheckout}
            onRequestDeleteBranch={onRequestDeleteBranch}
            onStartCreating={onStartCreating}
            onNewBranchChange={onNewBranchChange}
            onSubmitNewBranch={onSubmitNewBranch}
            onCancelCreate={onCancelCreate}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
