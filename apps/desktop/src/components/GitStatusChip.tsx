import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  Circle,
  Download,
  ExternalLink,
  GitBranch,
  GitCommit,
  Pencil,
  Plus,
  RefreshCcw,
  RefreshCw,
  Undo2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import type { ServiceId } from '@/types';

/** Poll cadence for the selected service's git snapshot. 15s keeps the badge
 *  meaningful without spamming the git CLI — the user sees branch switches
 *  done in an external terminal within the next tick. Port polling is faster
 *  (3s) because TCP listeners flip more often. */
const POLL_MS = 15_000;

type BusyOp =
  | 'fetch'
  | 'pull'
  | 'stash'
  | 'pop'
  | 'sync'
  | 'create'
  | 'undo'
  | 'amend'
  | { checkout: string };

export function GitStatusChip({ serviceId, cwd }: { serviceId: ServiceId; cwd: string }) {
  const git = useAppStore((s) => s.git[serviceId]);
  const setGit = useAppStore((s) => s.setGit);
  const editors = useAppStore((s) => s.editors);

  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<BusyOp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [amending, setAmending] = useState(false);
  const [amendMessage, setAmendMessage] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const newBranchInputRef = useRef<HTMLInputElement | null>(null);
  const amendInputRef = useRef<HTMLInputElement | null>(null);

  // First detected editor is used as the "open the changed files" target.
  // If none detected (user has no supported editor), we fall back to
  // revealing the folder in the OS file manager.
  const primaryEditor = useMemo(() => editors[0] ?? null, [editors]);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await ipc.gitStatus(serviceId);
      setGit(serviceId, s);
    } catch (e) {
      console.error('git_status failed', e);
    }
  }, [serviceId, setGit]);

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

  // Load branches lazily — list_branches shells out for every call and is
  // useless while the popover is closed. Re-run on branch changes so the
  // current-branch indicator stays in sync after an external checkout.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const list = await ipc.gitBranches(serviceId);
        if (alive) setBranches(list);
      } catch (e) {
        console.error('git_branches failed', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, serviceId, git?.branch]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as HTMLElement)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
  // any spurious ff-only failure message.
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
      await ipc.gitCreateBranch(serviceId, name);
      setNewBranch('');
      setCreating(false);
      await refreshStatus();
      // Re-pull branch list so the new branch shows up even if the user
      // opens the popover later — without this the list is stale until the
      // next open.
      try {
        const list = await ipc.gitBranches(serviceId);
        setBranches(list);
      } catch {
        // non-fatal
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Create branch failed');
    } finally {
      setBusy(null);
    }
  }, [serviceId, newBranch, refreshStatus]);

  const openInEditor = useCallback(async () => {
    try {
      if (primaryEditor) {
        await ipc.openInEditor(primaryEditor.command, cwd);
      } else {
        await ipc.openPath(cwd);
      }
    } catch (e) {
      console.error('open-in-editor failed', e);
    }
  }, [primaryEditor, cwd]);

  // Focus the New-branch input when it expands so the user can type
  // immediately without a second click.
  useEffect(() => {
    if (creating) newBranchInputRef.current?.focus();
  }, [creating]);

  // Same for the amend-message input. Select-all on focus so hitting the
  // pencil and typing immediately replaces the previous subject instead of
  // forcing the user to Cmd+A first.
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
      setErr(null);
    }
  }, [open]);

  const submitAmend = useCallback(async () => {
    const msg = amendMessage.trim();
    if (!msg) return;
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
  }, [serviceId, amendMessage, refreshStatus]);

  // `null` means "checked, not a repo" — hide the chip entirely so the
  // header doesn't accumulate dead-weight controls for non-git services.
  if (git === null) return null;

  if (git === undefined) {
    return (
      <div className="border-border bg-surface-muted/70 text-fg-dim rounded-app-sm flex h-7 items-center gap-1.5 border px-2 text-[12px]">
        <GitBranch className="h-3 w-3" />
        <span>…</span>
      </div>
    );
  }

  const { branch, ahead, behind, is_dirty, dirty_count, upstream, last_commit, head_short } = git;
  const hasUpstream = !!upstream;
  const isSynced = hasUpstream && ahead === 0 && behind === 0;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={branch ? `Branch: ${branch}` : 'Detached HEAD'}
        className={cn(
          'border-border rounded-app-sm flex h-7 items-center gap-1.5 border px-2 text-[12px] font-medium transition',
          open
            ? 'border-accent/50 bg-accent/10 text-accent'
            : 'bg-surface-muted/70 text-fg-muted hover:text-fg hover:bg-surface-overlay',
        )}
      >
        <GitBranch className={cn('h-3 w-3', open ? 'text-accent' : 'text-fg-dim')} />
        <span className="max-w-[140px] truncate">
          {branch ?? (head_short ? `(${head_short})` : 'detached')}
        </span>
        {ahead > 0 && (
          <span className="text-status-running inline-flex items-center tabular-nums">
            <ArrowUp className="h-2.5 w-2.5" />
            {ahead}
          </span>
        )}
        {behind > 0 && (
          <span className="text-status-starting inline-flex items-center tabular-nums">
            <ArrowDown className="h-2.5 w-2.5" />
            {behind}
          </span>
        )}
        {is_dirty && (
          <span
            className="bg-status-starting/80 ml-0.5 h-1.5 w-1.5 rounded-full"
            title={`${dirty_count} changed file${dirty_count === 1 ? '' : 's'}`}
            aria-label={`${dirty_count} uncommitted changes`}
          />
        )}
      </button>

      {open && (
        <div
          className="border-border bg-surface-raised rounded-app-lg animate-fade-in absolute top-full right-0 z-50 mt-1.5 flex max-h-[calc(100vh-96px)] w-[360px] flex-col overflow-y-auto border shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
          role="dialog"
        >
          <div className="border-border bg-surface-muted text-fg-dim flex items-center justify-between border-b px-3 py-1.5 text-[10px] tracking-wide uppercase">
            <span>Git</span>
            <span className="truncate font-mono tracking-normal normal-case">
              {upstream ?? 'no upstream'}
            </span>
          </div>

          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <GitBranch className="text-accent h-3.5 w-3.5 shrink-0" />
              <span className="text-fg truncate text-[13px] font-semibold">
                {branch ?? 'detached'}
              </span>
              <span className="text-fg-dim ml-auto shrink-0 font-mono text-[10.5px]">
                {head_short ?? '—'}
              </span>
            </div>

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
              <button
                type="button"
                onClick={() => void openInEditor()}
                title={
                  primaryEditor
                    ? `Open in ${primaryEditor.name}`
                    : 'Reveal working tree in file manager'
                }
                className={cn(
                  'ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 transition',
                  is_dirty ? 'text-status-starting' : 'text-status-running',
                  'hover:bg-surface-overlay/70 hover:underline',
                )}
              >
                <Circle
                  className={cn('h-2 w-2 fill-current', !is_dirty && 'opacity-60')}
                  aria-hidden
                />
                {is_dirty ? `${dirty_count} dirty` : 'clean'}
                <ExternalLink className="h-2.5 w-2.5 opacity-60" />
              </button>
            </div>

            {last_commit && (
              <div className="border-border bg-surface-muted/50 mt-2.5 rounded-md border px-2 py-1.5">
                {amending ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitAmend();
                    }}
                    className="flex items-center gap-1"
                  >
                    <GitCommit className="text-fg-dim h-3 w-3 shrink-0" />
                    <input
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
                      }}
                      placeholder="new commit message"
                      className="border-border bg-surface-muted/60 text-fg placeholder:text-fg-dim focus:border-accent/60 focus:bg-surface h-6 min-w-0 flex-1 rounded border px-1.5 text-[11.5px] transition focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={busy !== null || !amendMessage.trim()}
                      className="btn-chrome text-fg flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === 'amend' ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      Amend
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAmending(false);
                        setAmendMessage('');
                        setErr(null);
                      }}
                      className="text-fg-dim hover:text-fg flex h-6 w-6 shrink-0 items-center justify-center rounded transition"
                      aria-label="Cancel"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="text-fg flex items-center gap-1.5 text-[11.5px]">
                      <GitCommit className="text-fg-dim h-3 w-3 shrink-0" />
                      <span className="truncate">{last_commit.subject}</span>
                    </div>
                    <div className="text-fg-dim mt-0.5 flex items-center gap-1.5 text-[10px]">
                      <span className="font-mono">{last_commit.hash_short}</span>
                      <span>·</span>
                      <span className="truncate">{last_commit.author}</span>
                      <span>·</span>
                      <span className="shrink-0">{relativeTime(last_commit.timestamp)}</span>
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
                          onClick={() => void run('undo', () => ipc.gitUndoLastCommit(serviceId))}
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

            {err && (
              <div className="text-status-error bg-status-error/10 mt-2 flex max-h-24 items-start gap-1.5 overflow-y-auto rounded-md px-2 py-1 text-[11px]">
                <span className="flex-1 break-words whitespace-pre-wrap">{err}</span>
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

            <div className="mt-2.5 flex flex-wrap items-center gap-1">
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
                title={
                  !hasUpstream
                    ? 'No upstream — nothing to pull'
                    : behind === 0
                      ? 'Already up to date'
                      : 'git pull --ff-only'
                }
              />
              <ActionBtn
                disabled={busy !== null || !is_dirty}
                loading={busy === 'stash'}
                onClick={() => void run('stash', () => ipc.gitStash(serviceId, null))}
                icon={<Archive className="h-3 w-3" />}
                label="Stash"
                title={!is_dirty ? 'Nothing to stash' : 'git stash push --include-untracked'}
              />
              <ActionBtn
                disabled={busy !== null}
                loading={busy === 'pop'}
                onClick={() => void run('pop', () => ipc.gitStashPop(serviceId))}
                icon={<ArchiveRestore className="h-3 w-3" />}
                label="Pop"
                title="git stash pop — reapply the most recent stash"
              />
            </div>
          </div>

          {branches && (
            <div className="border-border border-t">
              <div className="bg-surface-muted text-fg-dim flex items-center justify-between px-3 py-1.5 text-[10px] tracking-wide uppercase">
                <span>Switch branch</span>
                <span className="tracking-normal normal-case tabular-nums">{branches.length}</span>
              </div>
              {branches.length > 0 && (
                <div className="max-h-[200px] overflow-auto py-1">
                  {branches.map((b) => {
                    const current = b === branch;
                    const checking =
                      busy !== null && typeof busy === 'object' && busy.checkout === b;
                    return (
                      <button
                        key={b}
                        type="button"
                        disabled={busy !== null || current}
                        onClick={() =>
                          void run({ checkout: b }, () => ipc.gitCheckout(serviceId, b))
                        }
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] transition',
                          current
                            ? 'text-accent bg-accent/5'
                            : 'text-fg-muted hover:text-fg hover:bg-surface-muted/60',
                          'disabled:cursor-not-allowed disabled:opacity-60',
                        )}
                      >
                        {checking ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : current ? (
                          <Check className="text-accent h-3 w-3" />
                        ) : (
                          <GitBranch className="text-fg-dim h-3 w-3" />
                        )}
                        <span className="truncate">{b}</span>
                      </button>
                    );
                  })}
                </div>
              )}
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
      )}
    </div>
  );
}

function ActionBtn({
  disabled,
  loading,
  onClick,
  icon,
  label,
  title,
}: {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        'btn-chrome text-fg rounded-app-sm flex h-7 items-center gap-1.5 px-2 text-[11.5px] font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : icon}
      <span>{label}</span>
    </button>
  );
}

function relativeTime(tsSec: number): string {
  const diff = Date.now() / 1000 - tsSec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`;
  const d = new Date(tsSec * 1000);
  return d.toLocaleDateString();
}
