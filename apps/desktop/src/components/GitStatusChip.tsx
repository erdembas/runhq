import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Check,
  Copy,
  Download,
  GitBranch,
  GitCommit,
  Pencil,
  Plus,
  RefreshCcw,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { FileEdit } from 'lucide-react';
import { ConfirmDialog, type ConfirmTone } from '@/components/ui/ConfirmDialog';
import { GitStatusBadge } from '@/components/ui/GitStatusBadge';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/gitDiff';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import type { CommitSummary, GitStatus, ServiceId, TimelineEventType } from '@/types';

/** Poll cadence for the selected service's git snapshot. 15s keeps the badge
 *  meaningful without spamming the git CLI — the user sees branch switches
 *  done in an external terminal within the next tick. Port polling is faster
 *  (3s) because TCP listeners flip more often. */
const POLL_MS = 15_000;

/** Popover width in px. Wide enough for long branch names ("analyze-
 *  project-details-7geas") and the 4-button Sync/Fetch/Pull/Push row on
 *  one line without wrapping. Keep the constant in one place so the
 *  positioning math below stays in sync. */
const POPOVER_WIDTH = 440;

/** Number of recent commits surfaced below the last-commit card. 5 is the
 *  sweet spot — enough to glance at this session's work without turning
 *  the popover into a history browser (the dedicated History tab owns
 *  deep exploration). */
const RECENT_COMMIT_LIMIT = 5;

type BusyOp =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'stash'
  | 'pop'
  | 'sync'
  | 'create'
  | 'undo'
  | 'amend'
  | { checkout: string }
  | { delete: string };

/** Centralised confirmation state. One discriminated union is clearer than
 *  four parallel booleans and makes the dialog a pure function of `confirm`. */
type ConfirmState =
  | null
  | { kind: 'undo' }
  | { kind: 'amend'; message: string; pushed: boolean }
  | { kind: 'dirty-checkout'; target: string; dirtyCount: number }
  | { kind: 'delete-branch'; name: string; force: boolean };

export function GitStatusChip({ serviceId, compact }: { serviceId: ServiceId; compact?: boolean }) {
  const git = useAppStore((s) => s.git[serviceId]);
  const setGit = useAppStore((s) => s.setGit);
  const openDiffViewer = useAppStore((s) => s.openDiffViewer);

  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [remoteBranches, setRemoteBranches] = useState<string[] | null>(null);
  const [recentCommits, setRecentCommits] = useState<CommitSummary[] | null>(null);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [branchTab, setBranchTab] = useState<'local' | 'remote'>('local');
  const [branchSearch, setBranchSearch] = useState('');
  const [busy, setBusy] = useState<BusyOp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [amending, setAmending] = useState(false);
  const [amendMessage, setAmendMessage] = useState('');
  const [copiedHash, setCopiedHash] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const newBranchInputRef = useRef<HTMLInputElement | null>(null);
  const amendInputRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  // One-shot suppression of polling-derived events when the user just took an
  // in-app action whose semantics are more specific than what the poller can
  // infer. Example: explicit "New branch from X" should record as
  // `git_branch_created`, not the generic `git_checkout` the poller would
  // otherwise emit on the next tick.
  const suppressBranchSwitchRef = useRef<string | null>(null);

  const recordEvent = useCallback(
    (type: TimelineEventType, description: string) => {
      const svc = useAppStore.getState().services.find((s) => s.id === serviceId);
      ipc.recordTimelineEvent(type, serviceId, svc?.name ?? null, description).catch(() => {});
    },
    [serviceId],
  );

  const refreshStatus = useCallback(async () => {
    try {
      const latest = await ipc.gitStatus(serviceId);
      const prev = useAppStore.getState().git[serviceId];
      setGit(serviceId, latest);
      if (latest && prev) {
        detectAndRecordGitEvents(prev, latest, suppressBranchSwitchRef, recordEvent);
      }
    } catch (e) {
      console.error('git_status failed', e);
    }
  }, [serviceId, setGit, recordEvent]);

  // Initial fetch + polling while mounted. Resets whenever the selected
  // service changes so each service gets a fresh load on focus instead of
  // waiting up to POLL_MS for the shared timer to tick.
  useEffect(() => {
    let alive = true;
    void refreshStatus();
    const id = setInterval(() => {
      if (alive) void refreshStatus();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [refreshStatus]);

  // Load branches + recent commits lazily when the popover opens.
  // Re-run on branch changes so everything stays in sync after checkouts.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const [locals, remotes, log] = await Promise.all([
          ipc.gitBranches(serviceId),
          ipc.gitRemoteBranches(serviceId).catch(() => [] as string[]),
          ipc.gitLog(serviceId, null, RECENT_COMMIT_LIMIT + 1).catch(() => [] as CommitSummary[]),
        ]);
        if (!alive) return;
        setBranches(locals);
        setRemoteBranches(remotes);
        setRecentCommits(log);
      } catch (e) {
        console.error('git popover load failed', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, serviceId, git?.branch, git?.head_short]);

  // Position + outside-click / escape handling. `POPOVER_WIDTH` is anchored
  // to the chip's right edge; a hard 8px clamp on the left prevents the
  // popover from tucking under the traffic-lights / off-screen when the
  // chip lives near the left viewport border.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    if (wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      // Estimated max height — enough room for commits + branches sections.
      const estHeight = 560;
      const above = rect.bottom + estHeight > window.innerHeight;
      const rawLeft = rect.right - POPOVER_WIDTH;
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - POPOVER_WIDTH - 8));
      setPos(
        above
          ? { bottom: window.innerHeight - rect.top + 6, left }
          : { top: rect.bottom + 6, left },
      );
    }
    const onKey = (e: KeyboardEvent) => {
      // Don't eat Escape while a confirm dialog is up — the confirm's own
      // handler closes itself first, then a subsequent Esc can close the
      // popover. Checking `confirm !== null` also keeps us from dismissing
      // the popover out from under an in-progress destructive action.
      if (e.key === 'Escape' && !confirm) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, confirm]);

  const run = useCallback(
    async (op: BusyOp, fn: () => Promise<unknown>) => {
      setBusy(op);
      setErr(null);
      try {
        await fn();
        await refreshStatus();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg || 'Operation failed');
      } finally {
        setBusy(null);
      }
    },
    [refreshStatus],
  );

  // "Sync" = fetch then pull only if actually behind. `git pull` internally
  // fetches, but running fetch first lets us skip the merge attempt entirely
  // when nothing new came down, avoiding the "Already up to date." noise and
  // any spurious ff-only failure message. The pull itself will be picked up
  // by the status poller on the follow-up refresh (behind count drops) and
  // recorded as a `git_pull` event — no manual call needed here.
  const runSync = useCallback(async () => {
    setBusy('sync');
    setErr(null);
    try {
      await ipc.gitFetch(serviceId);
      const latest = await ipc.gitStatus(serviceId);
      setGit(serviceId, latest);
      if (latest && latest.upstream && latest.behind > 0) {
        await ipc.gitPull(serviceId);
        await refreshStatus();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Sync failed');
    } finally {
      setBusy(null);
    }
  }, [serviceId, setGit, refreshStatus]);

  const submitNewBranch = useCallback(async () => {
    const name = newBranch.trim();
    if (!name) return;
    setBusy('create');
    setErr(null);
    try {
      // `git checkout -b name` both creates and switches. The poller would
      // therefore fire `git_checkout` on the next tick — suppress that once
      // so we get the more specific `git_branch_created` event instead.
      suppressBranchSwitchRef.current = name;
      await ipc.gitCreateBranch(serviceId, name);
      recordEvent('git_branch_created', `Created branch ${name}`);
      setNewBranch('');
      setCreating(false);
      await refreshStatus();
      try {
        const list = await ipc.gitBranches(serviceId);
        setBranches(list);
      } catch {
        // non-fatal
      }
    } catch (e) {
      suppressBranchSwitchRef.current = null;
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Create branch failed');
    } finally {
      setBusy(null);
    }
  }, [serviceId, newBranch, refreshStatus, recordEvent]);

  useEffect(() => {
    if (creating) newBranchInputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (amending) {
      amendInputRef.current?.focus();
      amendInputRef.current?.select();
    }
  }, [amending]);

  // When the popover closes (outside click, Escape, explicit toggle), reset
  // the transient inline editors so they don't reopen mid-flow on the next
  // show. Without this, typing a partial branch/amend message then clicking
  // outside would persist state invisibly and confuse the next interaction.
  useEffect(() => {
    if (!open) {
      setCreating(false);
      setNewBranch('');
      setAmending(false);
      setAmendMessage('');
      setBranchSearch('');
      setRecentExpanded(false);
      setConfirm(null);
      setErr(null);
    }
  }, [open]);

  const performAmend = useCallback(
    async (msg: string) => {
      setBusy('amend');
      setErr(null);
      try {
        await ipc.gitAmendCommitMessage(serviceId, msg);
        setAmending(false);
        setAmendMessage('');
        await refreshStatus();
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        setErr(m || 'Amend failed');
      } finally {
        setBusy(null);
      }
    },
    [serviceId, refreshStatus],
  );

  // Amend submit: if the commit has already been pushed (ahead === 0 and we
  // have an upstream and the last commit subject is the tip), warn before
  // rewriting — force-push is required to reconcile, and there's no way to
  // do that automatically from this dropdown.
  const submitAmend = useCallback(() => {
    const msg = amendMessage.trim();
    if (!msg) return;
    const g = useAppStore.getState().git[serviceId];
    const pushed = !!(g && g.upstream && g.ahead === 0);
    if (pushed) {
      setConfirm({ kind: 'amend', message: msg, pushed: true });
      return;
    }
    void performAmend(msg);
  }, [amendMessage, serviceId, performAmend]);

  const performCheckout = useCallback(
    (target: string) => {
      // Strip remote prefix so `origin/develop` → `develop`. Git will
      // auto-create the local tracking branch if it doesn't exist.
      const localName = target.includes('/') ? target.split('/').slice(1).join('/') : target;
      void run({ checkout: localName }, () => ipc.gitCheckout(serviceId, localName));
    },
    [run, serviceId],
  );

  // Guarded checkout: if the working tree is dirty, git's own safety net
  // will catch the *modified* file case but it will silently overwrite
  // untracked files when they conflict. We pop a confirm for any dirty
  // tree to make the loss-of-work risk explicit.
  const requestCheckout = useCallback(
    (target: string) => {
      const g = useAppStore.getState().git[serviceId];
      if (g && g.is_dirty && g.dirty_count > 0) {
        setConfirm({
          kind: 'dirty-checkout',
          target,
          dirtyCount: g.dirty_count,
        });
        return;
      }
      performCheckout(target);
    },
    [serviceId, performCheckout],
  );

  const performDeleteBranch = useCallback(
    async (name: string, force: boolean) => {
      await run({ delete: name }, async () => {
        await ipc.gitDeleteBranch(serviceId, name, force);
        recordEvent(
          'git_checkout',
          force ? `Force-deleted branch ${name}` : `Deleted branch ${name}`,
        );
        try {
          const list = await ipc.gitBranches(serviceId);
          setBranches(list);
        } catch {
          // non-fatal; next open will re-fetch
        }
      });
    },
    [run, serviceId, recordEvent],
  );

  const requestDeleteBranch = useCallback((name: string) => {
    setConfirm({ kind: 'delete-branch', name, force: false });
  }, []);

  const copyHash = useCallback(async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1200);
    } catch {
      // Clipboard can fail in non-secure contexts; swallow quietly.
    }
  }, []);

  // `null` means "checked, not a repo" — hide the chip entirely so the
  // header doesn't accumulate dead-weight controls for non-git services.
  if (git === null) return null;

  if (git === undefined) {
    return (
      <div
        className={cn(
          'border-border bg-surface-muted/70 text-fg-dim rounded-app-sm flex items-center gap-1.5 border px-2 text-[12px]',
          compact ? 'h-6' : 'h-7',
        )}
      >
        <GitBranch className="h-3 w-3" />
        {!compact && <span>…</span>}
      </div>
    );
  }

  const { branch, ahead, behind, is_dirty, dirty_count, upstream, last_commit, head_short } = git;
  const hasUpstream = !!upstream;
  const isSynced = hasUpstream && ahead === 0 && behind === 0;

  // Filter the active branch list by the search input (case-insensitive
  // substring). When searching, current branch still appears first even if
  // not matched, because hiding it is disorienting.
  const activeBranchList = branchTab === 'local' ? branches : remoteBranches;
  const filteredBranches = (() => {
    if (!activeBranchList) return null;
    const q = branchSearch.trim().toLowerCase();
    if (!q) return activeBranchList;
    return activeBranchList.filter((b) => b.toLowerCase().includes(q));
  })();

  // Slice recent commits: skip the one already shown in the last-commit
  // card. We fetched LIMIT + 1 precisely so we have LIMIT left after that.
  const olderCommits = (recentCommits ?? []).slice(1, 1 + RECENT_COMMIT_LIMIT);

  return (
    <>
      <div ref={wrapRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={branch ? `Branch: ${branch}` : 'Detached HEAD'}
          className={cn(
            'border-border rounded-app-sm flex items-center gap-1 border font-medium transition',
            compact ? 'h-6 px-1.5 text-[11px]' : 'h-7 gap-1.5 px-2 text-[12px]',
            open
              ? 'border-accent/50 bg-accent/10 text-accent'
              : 'bg-surface-muted/70 text-fg-muted hover:text-fg hover:bg-surface-overlay',
          )}
        >
          <GitBranch
            className={cn(compact ? 'h-3 w-3' : 'h-3 w-3', open ? 'text-accent' : 'text-fg-dim')}
          />
          <span className={cn('truncate', compact ? 'max-w-[100px]' : 'max-w-[140px]')}>
            {branch ?? (head_short ? `(${head_short})` : 'detached')}
          </span>
          {ahead > 0 && (
            <span className="text-status-running inline-flex items-center tabular-nums">
              <ArrowUp className={compact ? 'h-2.5 w-2.5' : 'h-2.5 w-2.5'} />
              {ahead}
            </span>
          )}
          {behind > 0 && (
            <span className="text-status-starting inline-flex items-center tabular-nums">
              <ArrowDown className={compact ? 'h-2.5 w-2.5' : 'h-2.5 w-2.5'} />
              {behind}
            </span>
          )}
          {is_dirty && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openDiffViewer(serviceId);
              }}
              className="bg-status-starting/80 hover:bg-status-starting ml-0.5 h-1.5 w-1.5 rounded-full"
              title={`${dirty_count} changed file${dirty_count === 1 ? '' : 's'} — click to view diff`}
              aria-label={`${dirty_count} uncommitted changes — view diff`}
            />
          )}
        </button>
      </div>

      {open &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-9998 bg-black/20 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div
              className="border-border bg-surface-raised rounded-app-lg animate-fade-in fixed z-9999 flex max-h-[calc(100vh-96px)] flex-col overflow-hidden border shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
              style={{
                width: POPOVER_WIDTH,
                ...(pos ? { top: pos.top, bottom: pos.bottom, left: pos.left } : {}),
              }}
              role="dialog"
            >
              {/* ── Header strip ─────────────────────────────────────── */}
              <div className="border-border bg-surface-muted text-fg-dim flex shrink-0 items-center justify-between border-b px-3 py-1.5 text-[10px] tracking-wide uppercase">
                <span>Git</span>
                <span className="truncate font-mono tracking-normal normal-case">
                  {upstream ?? 'no upstream'}
                </span>
              </div>

              {/* ── Scrollable body ──────────────────────────────────── */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-3 py-2.5">
                  {/* Branch + HEAD */}
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="text-accent h-3.5 w-3.5 shrink-0" />
                    <span className="text-fg truncate text-[13px] font-semibold">
                      {branch ?? 'detached'}
                    </span>
                    <span className="text-fg-dim ml-auto shrink-0 font-mono text-[10.5px]">
                      {head_short ?? '—'}
                    </span>
                  </div>

                  {/* Sync status + dirty badge */}
                  <div className="text-fg-muted mt-1.5 flex items-center gap-3 text-[11px]">
                    {hasUpstream ? (
                      isSynced ? (
                        <span className="text-status-running inline-flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          up to date
                        </span>
                      ) : (
                        <>
                          {ahead > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <ArrowUp className="text-status-running h-3 w-3" />
                              <span className="tabular-nums">{ahead}</span> ahead
                            </span>
                          )}
                          {behind > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <ArrowDown className="text-status-starting h-3 w-3" />
                              <span className="tabular-nums">{behind}</span> behind
                            </span>
                          )}
                        </>
                      )
                    ) : (
                      <span className="text-fg-dim">no upstream</span>
                    )}
                    <span className="ml-auto">
                      <GitStatusBadge
                        git={git}
                        onClick={
                          git.is_dirty && git.dirty_count > 0
                            ? () => {
                                setOpen(false);
                                openDiffViewer(serviceId);
                              }
                            : undefined
                        }
                        title={
                          git.is_dirty && git.dirty_count > 0
                            ? `View ${git.dirty_count} uncommitted change${git.dirty_count === 1 ? '' : 's'}`
                            : undefined
                        }
                      />
                    </span>
                  </div>

                  {/* Error banner — moved ABOVE the commit card so failures
                      are seen before the next action the user would take.
                      Keeping it below actions (as before) meant a user who
                      retried immediately would miss the error entirely. */}
                  {err && (
                    <div className="text-status-error bg-status-error/10 border-status-error/25 mt-2.5 flex max-h-24 items-start gap-1.5 overflow-y-auto rounded-md border px-2 py-1.5 text-[11px]">
                      <span className="flex-1 wrap-break-word whitespace-pre-wrap">{err}</span>
                      <button
                        type="button"
                        onClick={() => setErr(null)}
                        aria-label="Dismiss error"
                        className="text-status-error/70 hover:text-status-error sticky top-0 shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  {/* Last commit card */}
                  {last_commit && (
                    <div className="border-border bg-surface-muted/50 mt-2.5 rounded-md border px-2 py-1.5">
                      {amending ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            submitAmend();
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
                            onChange={(e) => setAmendMessage(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setAmending(false);
                                setAmendMessage('');
                                setErr(null);
                              }
                              // Cmd/Ctrl + Enter to commit matches VSCode.
                              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                submitAmend();
                              }
                            }}
                            placeholder="Subject line&#10;&#10;Optional body — wrap at ~72 chars."
                            rows={3}
                            className="border-border bg-surface-muted/60 text-fg placeholder:text-fg-dim focus:border-accent/60 focus:bg-surface min-h-[56px] w-full resize-y rounded border px-1.5 py-1 text-[11.5px] leading-snug transition focus:outline-none"
                          />
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-fg-dim text-[10px]">
                              <span className="bg-surface-muted rounded px-1 font-mono">⌘↵</span>{' '}
                              Commit ·{' '}
                              <span className="bg-surface-muted rounded px-1 font-mono">Esc</span>{' '}
                              Cancel
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setAmending(false);
                                  setAmendMessage('');
                                  setErr(null);
                                }}
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
                            <span className="truncate" title={last_commit.subject}>
                              {last_commit.subject}
                            </span>
                          </div>
                          <div className="text-fg-dim mt-0.5 flex items-center gap-1.5 text-[10px]">
                            <button
                              type="button"
                              onClick={() => void copyHash(last_commit.hash_short)}
                              title="Copy hash"
                              className="hover:text-fg focus:text-fg flex items-center gap-1 font-mono transition focus:outline-none"
                            >
                              {copiedHash ? (
                                <Check className="text-status-running h-2.5 w-2.5" />
                              ) : (
                                <Copy className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100" />
                              )}
                              <span>{last_commit.hash_short}</span>
                            </button>
                            <span>·</span>
                            <span className="truncate">{last_commit.author}</span>
                            <span>·</span>
                            <span className="shrink-0">{timeAgo(last_commit.timestamp)}</span>
                            <div className="ml-auto flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => {
                                  setAmendMessage(last_commit.subject);
                                  setAmending(true);
                                }}
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
                                onClick={() => setConfirm({ kind: 'undo' })}
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
                  )}

                  {/* Recent commits (collapsed by default) */}
                  {olderCommits.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setRecentExpanded((v) => !v)}
                        className="text-fg-dim hover:text-fg flex w-full items-center gap-1 text-[10px] tracking-wide uppercase transition"
                      >
                        <span>{recentExpanded ? '▾' : '▸'}</span>
                        <span>Recent commits</span>
                        <span className="tabular-nums">({olderCommits.length})</span>
                      </button>
                      {recentExpanded && (
                        <ul className="mt-1 space-y-0.5">
                          {olderCommits.map((c) => (
                            <li
                              key={c.hash_full}
                              className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px]"
                            >
                              <button
                                type="button"
                                onClick={() => void copyHash(c.hash_short)}
                                className="text-fg-dim hover:text-fg font-mono transition focus:outline-none"
                                title={`Copy ${c.hash_short}`}
                              >
                                {c.hash_short}
                              </button>
                              <span
                                className="text-fg-muted min-w-0 flex-1 truncate"
                                title={c.subject}
                              >
                                {c.subject}
                              </span>
                              <span className="text-fg-dim shrink-0 text-[10px] tabular-nums">
                                {timeAgo(c.timestamp)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Primary sync actions — one row */}
                  <div className="mt-3 grid grid-cols-4 gap-1">
                    <ActionBtn
                      disabled={busy !== null || !hasUpstream}
                      loading={busy === 'sync'}
                      onClick={() => void runSync()}
                      icon={<RefreshCcw className="h-3 w-3" />}
                      label="Sync"
                      title={
                        !hasUpstream
                          ? 'No upstream — set one first'
                          : 'Fetch, then pull --ff-only if behind'
                      }
                    />
                    <ActionBtn
                      disabled={busy !== null}
                      loading={busy === 'fetch'}
                      onClick={() => void run('fetch', () => ipc.gitFetch(serviceId))}
                      icon={<Download className="h-3 w-3" />}
                      label="Fetch"
                      title="git fetch --all --prune"
                    />
                    <ActionBtn
                      disabled={busy !== null || !hasUpstream || behind === 0}
                      loading={busy === 'pull'}
                      onClick={() => void run('pull', () => ipc.gitPull(serviceId))}
                      icon={<ArrowDownToLine className="h-3 w-3" />}
                      label="Pull"
                      badge={behind > 0 ? String(behind) : undefined}
                      title={
                        !hasUpstream
                          ? 'No upstream — nothing to pull'
                          : behind === 0
                            ? 'Already up to date'
                            : `git pull --ff-only (${behind} behind)`
                      }
                    />
                    <ActionBtn
                      disabled={busy !== null || !hasUpstream || ahead === 0}
                      loading={busy === 'push'}
                      onClick={() => void run('push', () => ipc.gitPush(serviceId))}
                      icon={<ArrowUpToLine className="h-3 w-3" />}
                      label="Push"
                      badge={ahead > 0 ? String(ahead) : undefined}
                      title={
                        !hasUpstream
                          ? 'No upstream — set one first'
                          : ahead === 0
                            ? 'Nothing to push'
                            : `git push (${ahead} ahead)`
                      }
                    />
                  </div>

                  {/* Secondary work-tree actions */}
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    <ActionBtn
                      disabled={busy !== null || !is_dirty}
                      loading={busy === 'stash'}
                      onClick={() =>
                        void run('stash', async () => {
                          const priorDirty = dirty_count;
                          await ipc.gitStash(serviceId, null);
                          recordEvent(
                            'git_stash',
                            `Stashed ${priorDirty} change${priorDirty === 1 ? '' : 's'}`,
                          );
                        })
                      }
                      icon={<Archive className="h-3 w-3" />}
                      label="Stash"
                      title={!is_dirty ? 'Nothing to stash' : 'git stash push --include-untracked'}
                    />
                    <ActionBtn
                      disabled={busy !== null}
                      loading={busy === 'pop'}
                      onClick={() =>
                        void run('pop', async () => {
                          await ipc.gitStashPop(serviceId);
                          recordEvent('git_stash', 'Popped most recent stash');
                        })
                      }
                      icon={<ArchiveRestore className="h-3 w-3" />}
                      label="Pop"
                      title="git stash pop — reapply the most recent stash"
                    />
                    <ActionBtn
                      disabled={!is_dirty}
                      loading={false}
                      onClick={() => {
                        setOpen(false);
                        openDiffViewer(serviceId);
                      }}
                      icon={<FileEdit className="h-3 w-3" />}
                      label="Diff"
                      badge={is_dirty ? String(dirty_count) : undefined}
                      title={!is_dirty ? 'No changes to diff' : 'View uncommitted changes'}
                    />
                  </div>
                </div>

                {/* ── Branches section ─────────────────────────────── */}
                {(branches || remoteBranches) && (
                  <div className="border-border border-t">
                    <div className="bg-surface-muted text-fg-dim flex items-center justify-between px-3 py-1.5 text-[10px] tracking-wide uppercase">
                      <span>Branches</span>
                      <span className="tracking-normal normal-case tabular-nums">
                        {(branches?.length ?? 0) + (remoteBranches?.length ?? 0)}
                      </span>
                    </div>

                    {/* Search + tabs */}
                    <div className="border-border flex items-center gap-2 border-b px-2 py-1.5">
                      <div className="relative min-w-0 flex-1">
                        <Search className="text-fg-dim pointer-events-none absolute top-1/2 left-1.5 h-3 w-3 -translate-y-1/2" />
                        <input
                          ref={searchInputRef}
                          value={branchSearch}
                          onChange={(e) => setBranchSearch(e.target.value)}
                          placeholder="Search branches…"
                          className="border-border bg-surface-muted/60 text-fg placeholder:text-fg-dim focus:border-accent/60 focus:bg-surface h-6 w-full rounded border pr-1.5 pl-6 text-[11.5px] transition focus:outline-none"
                        />
                        {branchSearch && (
                          <button
                            type="button"
                            onClick={() => setBranchSearch('')}
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
                          onClick={() => setBranchTab('local')}
                          count={branches?.length ?? 0}
                        >
                          Local
                        </BranchTab>
                        <BranchTab
                          active={branchTab === 'remote'}
                          onClick={() => setBranchTab('remote')}
                          count={remoteBranches?.length ?? 0}
                        >
                          Remote
                        </BranchTab>
                      </div>
                    </div>

                    {/* Branch list */}
                    <div className="max-h-[220px] overflow-auto py-1">
                      {filteredBranches?.length === 0 && (
                        <div className="text-fg-dim px-3 py-4 text-center text-[11px]">
                          {branchSearch
                            ? `No ${branchTab} branches match "${branchSearch}"`
                            : `No ${branchTab} branches`}
                        </div>
                      )}
                      {filteredBranches?.map((b) => {
                        const current =
                          b === branch || b === `${upstream}` || b.endsWith(`/${branch ?? ''}`);
                        const checking =
                          busy !== null &&
                          typeof busy === 'object' &&
                          'checkout' in busy &&
                          (busy.checkout === b ||
                            busy.checkout === b.split('/').slice(1).join('/'));
                        const deleting =
                          busy !== null &&
                          typeof busy === 'object' &&
                          'delete' in busy &&
                          busy.delete === b;
                        const isRemote = branchTab === 'remote';
                        return (
                          <div
                            key={b}
                            className={cn(
                              'group flex items-center gap-2 pr-1 pl-3 transition',
                              current
                                ? 'text-accent bg-accent/5'
                                : 'text-fg-muted hover:bg-surface-muted/60',
                            )}
                          >
                            <button
                              type="button"
                              disabled={busy !== null || (current && branchTab === 'local')}
                              onClick={() => requestCheckout(b)}
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
                              <span className="truncate">{b}</span>
                            </button>
                            {/* Delete button — only for local branches other
                                than the current one. Remote branches can't be
                                deleted via `git branch -d`; that's a separate
                                (destructive) `git push --delete` we don't
                                expose here. */}
                            {!isRemote && !current && (
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestDeleteBranch(b);
                                }}
                                title={`Delete ${b}`}
                                aria-label={`Delete ${b}`}
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

                    {/* New branch footer */}
                    <div className="border-border border-t px-2 py-1.5">
                      {creating ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void submitNewBranch();
                          }}
                          className="flex items-center gap-1"
                        >
                          <GitBranch className="text-fg-dim h-3 w-3 shrink-0" />
                          <input
                            ref={newBranchInputRef}
                            value={newBranch}
                            onChange={(e) => setNewBranch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setCreating(false);
                                setNewBranch('');
                                setErr(null);
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
                            onClick={() => {
                              setCreating(false);
                              setNewBranch('');
                              setErr(null);
                            }}
                            className="text-fg-dim hover:text-fg flex h-6 w-6 shrink-0 items-center justify-center rounded transition"
                            aria-label="Cancel"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCreating(true)}
                          disabled={busy !== null}
                          className="text-fg-muted hover:text-fg hover:bg-surface-muted/60 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[12px] transition disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Plus className="text-fg-dim h-3 w-3" />
                          <span>New branch from {branch ?? 'HEAD'}…</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>,
          document.body,
        )}

      {/* Confirmation dialogs. Rendered outside the popover so they work
          even if the popover scrolls / re-layouts; each dialog is self-
          contained (full modal) so we don't need a focus trap here. */}
      {confirm?.kind === 'undo' && (
        <ConfirmDialog
          title="Undo last commit?"
          message={`HEAD will move back one commit. Your changes stay staged — nothing is lost on disk.\n\nThis is equivalent to: git reset --soft HEAD~1`}
          details={last_commit ? `${last_commit.hash_short}  ${last_commit.subject}` : undefined}
          confirmLabel="Undo commit"
          tone="warning"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void run('undo', () => ipc.gitUndoLastCommit(serviceId));
          }}
        />
      )}

      {confirm?.kind === 'amend' && (
        <ConfirmDialog
          title="Rewrite commit that's already on the remote?"
          message={
            confirm.pushed
              ? `This commit appears to have been pushed. Amending it rewrites history — anyone who pulled the original will diverge.\n\nYou'll need a force-push (ideally --force-with-lease) to reconcile. Only proceed if you own this branch.`
              : 'This rewrites the current commit with a new message.'
          }
          details={confirm.message}
          confirmLabel="Amend anyway"
          tone={confirm.pushed ? ('danger' as ConfirmTone) : ('warning' as ConfirmTone)}
          confirmWord={confirm.pushed ? 'amend' : undefined}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const m = confirm.message;
            setConfirm(null);
            void performAmend(m);
          }}
        />
      )}

      {confirm?.kind === 'dirty-checkout' && (
        <ConfirmDialog
          title={`Switch to ${confirm.target}?`}
          message={`You have ${confirm.dirtyCount} uncommitted change${confirm.dirtyCount === 1 ? '' : 's'}. Git will refuse the checkout if any tracked file would be overwritten, but untracked files may still be clobbered.\n\nConsider stashing first. Proceed anyway?`}
          confirmLabel="Switch anyway"
          tone="warning"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const t = confirm.target;
            setConfirm(null);
            performCheckout(t);
          }}
        />
      )}

      {confirm?.kind === 'delete-branch' && (
        <ConfirmDialog
          title={confirm.force ? `Force-delete ${confirm.name}?` : `Delete ${confirm.name}?`}
          message={
            confirm.force
              ? `This branch contains commits not merged into HEAD. Force-delete discards those commits — if they weren't pushed elsewhere, they're gone.\n\nOnly proceed if you're sure.`
              : `Delete the local branch "${confirm.name}". If it has unmerged commits, git will refuse and you'll get an option to force-delete.`
          }
          confirmLabel={confirm.force ? 'Force delete' : 'Delete'}
          tone={confirm.force ? ('danger' as ConfirmTone) : ('warning' as ConfirmTone)}
          confirmWord={confirm.force ? confirm.name : undefined}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const { name, force } = confirm;
            setConfirm(null);
            try {
              await performDeleteBranch(name, force);
            } catch (e) {
              // `run` sets err; if not-merged was the reason, escalate to a
              // second confirmation that requires typing the branch name.
              const msg = e instanceof Error ? e.message : String(e);
              if (!force && /not fully merged/i.test(msg)) {
                setConfirm({ kind: 'delete-branch', name, force: true });
              }
            }
          }}
        />
      )}
    </>
  );
}

function ActionBtn({
  disabled,
  loading,
  onClick,
  icon,
  label,
  title,
  badge,
}: {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
  /** Optional small counter, e.g. "3" for "3 ahead" on the Push button. */
  badge?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        'btn-chrome text-fg rounded-app-sm relative flex h-7 min-w-0 items-center justify-center gap-1.5 px-2 text-[11.5px] font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {loading ? <RefreshCw className="h-3 w-3 shrink-0 animate-spin" /> : icon}
      <span className="truncate">{label}</span>
      {badge !== undefined && !loading && (
        <span className="bg-accent/25 text-accent rounded px-1 font-mono text-[9.5px] leading-[14px] tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}

function BranchTab({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-[22px] items-center gap-1 rounded px-2 transition',
        active ? 'bg-accent/15 text-accent' : 'text-fg-dim hover:text-fg hover:bg-surface-muted/60',
      )}
    >
      <span>{children}</span>
      <span className="text-fg-dim tabular-nums">{count}</span>
    </button>
  );
}

/**
 * Compares two consecutive `gitStatus` snapshots and records timeline events
 * for whatever changed between them. This is the single source of truth for
 * push / pull / commit / checkout detection — it catches changes regardless
 * of their origin (in-app button, terminal, external IDE, filesystem hooks).
 *
 * Heuristics, in order:
 *   1. Branch changed            → git_checkout (unless suppressed by a
 *                                   just-executed create-branch action).
 *   2. behind decreased          → git_pull N
 *   3. HEAD hash changed and
 *      branch didn't change and
 *      behind didn't drop:
 *        · ahead increased       → git_commit (new local commit subject)
 *        · ahead decreased       → git_commit "Reverted last commit" (soft reset / undo)
 *        · ahead unchanged       → git_commit "Amended: <subject>"
 *   4. ahead decreased, behind
 *      unchanged, HEAD hash
 *      unchanged                 → git_push N (remote caught up to local)
 */
function detectAndRecordGitEvents(
  prev: GitStatus,
  latest: GitStatus,
  suppressBranchSwitchRef: React.MutableRefObject<string | null>,
  record: (type: TimelineEventType, description: string) => void,
): void {
  if (latest.dirty_count > (prev.dirty_count ?? 0)) {
    record('file_changed', `${latest.dirty_count} uncommitted change(s)`);
  }

  const branchChanged = latest.branch !== prev.branch;
  if (branchChanged) {
    if (suppressBranchSwitchRef.current === latest.branch) {
      suppressBranchSwitchRef.current = null;
    } else if (latest.branch) {
      record('git_checkout', `Checked out ${latest.branch}`);
    }
    return;
  }

  const pulled = prev.behind > 0 && latest.behind < prev.behind;
  if (pulled) {
    const delta = prev.behind - latest.behind;
    record('git_pull', `Pulled ${delta} commit${delta === 1 ? '' : 's'}`);
  }

  const prevHash = prev.last_commit?.hash_short ?? null;
  const latestHash = latest.last_commit?.hash_short ?? null;
  const hashChanged = !!latestHash && prevHash !== latestHash;
  const aheadDelta = latest.ahead - prev.ahead;

  if (hashChanged && !pulled) {
    const subject = latest.last_commit?.subject ?? '(no subject)';
    if (aheadDelta > 0) {
      record('git_commit', subject);
    } else if (aheadDelta < 0) {
      record('git_commit', 'Reverted last commit');
    } else {
      record('git_commit', `Amended: ${subject}`);
    }
    return;
  }

  if (aheadDelta < 0 && latest.behind === prev.behind && !hashChanged) {
    const delta = prev.ahead - latest.ahead;
    record('git_push', `Pushed ${delta} commit${delta === 1 ? '' : 's'}`);
  }
}
