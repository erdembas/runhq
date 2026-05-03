import type { Ref } from 'react';
import { Check, GitBranch, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BranchTab } from './BranchTab';
import type { BranchSectionState, BranchTabKind, BusyOp } from './types';

interface BranchSectionProps {
  state: BranchSectionState;
  busy: BusyOp | null;
  branch: string | null;
  upstream: string | null;
  searchInputRef: Ref<HTMLInputElement>;
  newBranchInputRef: Ref<HTMLInputElement>;
  onBranchSearchChange: (value: string) => void;
  onBranchTabChange: (tab: BranchTabKind) => void;
  onRequestCheckout: (branch: string) => void;
  onRequestDeleteBranch: (branch: string) => void;
  onStartCreating: () => void;
  onNewBranchChange: (value: string) => void;
  onSubmitNewBranch: () => void;
  onCancelCreate: () => void;
}

export function BranchSection({
  state,
  busy,
  branch,
  upstream,
  searchInputRef,
  newBranchInputRef,
  onBranchSearchChange,
  onBranchTabChange,
  onRequestCheckout,
  onRequestDeleteBranch,
  onStartCreating,
  onNewBranchChange,
  onSubmitNewBranch,
  onCancelCreate,
}: BranchSectionProps) {
  const {
    branches,
    remoteBranches,
    filteredBranches,
    branchTab,
    branchSearch,
    creating,
    newBranch,
  } = state;

  if (!branches && !remoteBranches) return null;

  return (
    <div className="border-border border-t">
      <div className="bg-surface-muted text-fg-dim flex items-center justify-between px-3 py-1.5 text-[10px] tracking-wide uppercase">
        <span>Branches</span>
        <span className="tracking-normal normal-case tabular-nums">
          {(branches?.length ?? 0) + (remoteBranches?.length ?? 0)}
        </span>
      </div>

      <div className="border-border flex items-center gap-2 border-b px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="text-fg-dim pointer-events-none absolute top-1/2 left-1.5 h-3 w-3 -translate-y-1/2" />
          <input
            ref={searchInputRef}
            value={branchSearch}
            onChange={(e) => onBranchSearchChange(e.target.value)}
            placeholder="Search branches…"
            className="border-border bg-surface-muted/60 text-fg placeholder:text-fg-dim focus:border-accent/60 focus:bg-surface h-6 w-full rounded border pr-1.5 pl-6 text-[11.5px] transition focus:outline-none"
          />
          {branchSearch && (
            <button
              type="button"
              onClick={() => onBranchSearchChange('')}
              className="text-fg-dim hover:text-fg absolute top-1/2 right-1 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="border-border flex h-6 shrink-0 items-center rounded border p-px text-[10.5px]">
          <BranchTab
            active={branchTab === 'local'}
            onClick={() => onBranchTabChange('local')}
            count={branches?.length ?? 0}
          >
            Local
          </BranchTab>
          <BranchTab
            active={branchTab === 'remote'}
            onClick={() => onBranchTabChange('remote')}
            count={remoteBranches?.length ?? 0}
          >
            Remote
          </BranchTab>
        </div>
      </div>

      <div className="max-h-[220px] overflow-auto py-1">
        {filteredBranches?.length === 0 && (
          <div className="text-fg-dim px-3 py-4 text-center text-[11px]">
            {branchSearch
              ? `No ${branchTab} branches match "${branchSearch}"`
              : `No ${branchTab} branches`}
          </div>
        )}
        {filteredBranches?.map((branchName) => {
          const current =
            branchName === branch ||
            branchName === `${upstream}` ||
            branchName.endsWith(`/${branch ?? ''}`);
          const checking =
            busy !== null &&
            typeof busy === 'object' &&
            'checkout' in busy &&
            (busy.checkout === branchName ||
              busy.checkout === branchName.split('/').slice(1).join('/'));
          const deleting =
            busy !== null &&
            typeof busy === 'object' &&
            'delete' in busy &&
            busy.delete === branchName;
          const isRemote = branchTab === 'remote';

          return (
            <div
              key={branchName}
              className={cn(
                'group flex items-center gap-2 pr-1 pl-3 transition',
                current ? 'text-accent bg-accent/5' : 'text-fg-muted hover:bg-surface-muted/60',
              )}
            >
              <button
                type="button"
                disabled={busy !== null || (current && branchTab === 'local')}
                onClick={() => onRequestCheckout(branchName)}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[12px] transition',
                  'hover:text-fg disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                {checking ? (
                  <RefreshCw className="h-3 w-3 shrink-0 animate-spin" />
                ) : current ? (
                  <Check className="text-accent h-3 w-3 shrink-0" />
                ) : (
                  <GitBranch className="text-fg-dim h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{branchName}</span>
              </button>
              {!isRemote && !current && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestDeleteBranch(branchName);
                  }}
                  title={`Delete ${branchName}`}
                  aria-label={`Delete ${branchName}`}
                  className={cn(
                    'text-fg-dim hover:text-status-error hover:bg-status-error/10 flex h-5 w-5 shrink-0 items-center justify-center rounded transition',
                    'opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  {deleting ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-border border-t px-2 py-1.5">
        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmitNewBranch();
            }}
            className="flex items-center gap-1"
          >
            <GitBranch className="text-fg-dim h-3 w-3 shrink-0" />
            <input
              ref={newBranchInputRef}
              value={newBranch}
              onChange={(e) => onNewBranchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelCreate();
                }
              }}
              placeholder={`new-branch from ${branch ?? 'HEAD'}`}
              className="border-border bg-surface-muted/60 text-fg placeholder:text-fg-dim focus:border-accent/60 focus:bg-surface h-6 min-w-0 flex-1 rounded border px-1.5 font-mono text-[11px] transition focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy !== null || !newBranch.trim()}
              className="btn-chrome text-fg flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'create' ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Create
            </button>
            <button
              type="button"
              onClick={onCancelCreate}
              className="text-fg-dim hover:text-fg flex h-6 w-6 shrink-0 items-center justify-center rounded transition"
              aria-label="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={onStartCreating}
            disabled={busy !== null}
            className="text-fg-muted hover:text-fg hover:bg-surface-muted/60 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[12px] transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="text-fg-dim h-3 w-3" />
            <span>New branch from {branch ?? 'HEAD'}…</span>
          </button>
        )}
      </div>
    </div>
  );
}
