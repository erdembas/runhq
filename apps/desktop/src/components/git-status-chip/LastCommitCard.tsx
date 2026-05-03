import type { Ref } from 'react';
import { Check, Copy, GitCommit, Pencil, RefreshCw, Undo2 } from 'lucide-react';
import { timeAgo } from '@/lib/gitDiff';
import type { BusyOp } from './types';
import type { GitCommitInfo } from '@/types';

interface LastCommitCardProps {
  lastCommit: GitCommitInfo | null;
  amending: boolean;
  amendInputRef: Ref<HTMLTextAreaElement>;
  amendMessage: string;
  busy: BusyOp | null;
  copiedHash: boolean;
  onAmendMessageChange: (value: string) => void;
  onSubmitAmend: () => void;
  onCancelAmend: () => void;
  onCopyHash: (hash: string) => void;
  onStartAmend: (message: string) => void;
  onRequestUndo: () => void;
}

export function LastCommitCard({
  lastCommit,
  amending,
  amendInputRef,
  amendMessage,
  busy,
  copiedHash,
  onAmendMessageChange,
  onSubmitAmend,
  onCancelAmend,
  onCopyHash,
  onStartAmend,
  onRequestUndo,
}: LastCommitCardProps) {
  if (!lastCommit) return null;

  return (
    <div className="border-border bg-surface-muted/50 mt-2.5 rounded-md border px-2 py-1.5">
      {amending ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitAmend();
          }}
          className="flex flex-col gap-1.5"
        >
          <div className="text-fg-dim flex items-center gap-1 text-[10px] tracking-wide uppercase">
            <GitCommit className="h-3 w-3 shrink-0" />
            Amend commit message
          </div>
          <textarea
            ref={amendInputRef}
            value={amendMessage}
            onChange={(e) => onAmendMessageChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onCancelAmend();
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onSubmitAmend();
              }
            }}
            placeholder="Subject line&#10;&#10;Optional body — wrap at ~72 chars."
            rows={3}
            className="border-border bg-surface-muted/60 text-fg placeholder:text-fg-dim focus:border-accent/60 focus:bg-surface min-h-[56px] w-full resize-y rounded border px-1.5 py-1 text-[11.5px] leading-snug transition focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-dim text-[10px]">
              <span className="bg-surface-muted rounded px-1 font-mono">⌘↵</span> Commit ·{' '}
              <span className="bg-surface-muted rounded px-1 font-mono">Esc</span> Cancel
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCancelAmend}
                className="text-fg-dim hover:text-fg h-6 rounded px-2 text-[11px] transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy !== null || !amendMessage.trim()}
                className="btn-chrome text-fg flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'amend' ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Amend
              </button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <div className="text-fg flex items-center gap-1.5 text-[11.5px]">
            <GitCommit className="text-fg-dim h-3 w-3 shrink-0" />
            <span className="truncate" title={lastCommit.subject}>
              {lastCommit.subject}
            </span>
          </div>
          <div className="text-fg-dim mt-0.5 flex items-center gap-1.5 text-[10px]">
            <button
              type="button"
              onClick={() => onCopyHash(lastCommit.hash_short)}
              title="Copy hash"
              className="hover:text-fg focus:text-fg flex items-center gap-1 font-mono transition focus:outline-none"
            >
              {copiedHash ? (
                <Check className="text-status-running h-2.5 w-2.5" />
              ) : (
                <Copy className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100" />
              )}
              <span>{lastCommit.hash_short}</span>
            </button>
            <span>·</span>
            <span className="truncate">{lastCommit.author}</span>
            <span>·</span>
            <span className="shrink-0">{timeAgo(lastCommit.timestamp)}</span>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => onStartAmend(lastCommit.subject)}
                title="Rewrite commit message (git commit --amend)"
                className="text-fg-dim hover:text-fg hover:bg-surface-overlay/70 flex h-5 w-5 items-center justify-center rounded transition disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Amend commit message"
              >
                {busy === 'amend' ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Pencil className="h-3 w-3" />
                )}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={onRequestUndo}
                title="Undo commit — keeps changes staged (git reset --soft HEAD~1)"
                className="text-fg-dim hover:text-status-starting hover:bg-status-starting/10 flex h-5 w-5 items-center justify-center rounded transition disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Undo last commit"
              >
                {busy === 'undo' ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Undo2 className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
