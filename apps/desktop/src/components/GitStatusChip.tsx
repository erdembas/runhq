import { useCallback, useEffect, useRef, useState } from 'react';
import { GitConfirmDialogs } from '@/components/git-status-chip/GitConfirmDialogs';
import { GitStatusPopover } from '@/components/git-status-chip/GitStatusPopover';
import { GitStatusTrigger } from '@/components/git-status-chip/GitStatusTrigger';
import { detectAndRecordGitEvents } from '@/components/git-status-chip/gitTimelineEvents';
import { useGitPopoverPosition } from '@/components/git-status-chip/useGitPopoverPosition';
import {
  POLL_MS,
  RECENT_COMMIT_LIMIT,
  type BranchTabKind,
  type BusyOp,
  type ConfirmState,
  type GitActionCallbacks,
} from '@/components/git-status-chip/types';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import type { CommitSummary, ServiceId, TimelineEventType } from '@/types';

export function GitStatusChip({ serviceId, compact }: { serviceId: ServiceId; compact?: boolean }) {
  const git = useAppStore((s) => s.git[serviceId]);
  const setGit = useAppStore((s) => s.setGit);
  const openDiffViewer = useAppStore((s) => s.openDiffViewer);

  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [remoteBranches, setRemoteBranches] = useState<string[] | null>(null);
  const [recentCommits, setRecentCommits] = useState<CommitSummary[] | null>(null);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [branchTab, setBranchTab] = useState<BranchTabKind>('local');
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
  const suppressBranchSwitchRef = useRef<string | null>(null);
  const closePopover = useCallback(() => setOpen(false), []);
  const pos = useGitPopoverPosition({ open, confirm, anchorRef: wrapRef, onClose: closePopover });
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
        /* non-fatal */
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
      const localName = target.includes('/') ? target.split('/').slice(1).join('/') : target;
      void run({ checkout: localName }, () => ipc.gitCheckout(serviceId, localName));
    },
    [run, serviceId],
  );

  const requestCheckout = useCallback(
    (target: string) => {
      const g = useAppStore.getState().git[serviceId];
      if (g && g.is_dirty && g.dirty_count > 0) {
        setConfirm({ kind: 'dirty-checkout', target, dirtyCount: g.dirty_count });
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
          /* non-fatal; next open will re-fetch */
        }
      });
    },
    [run, serviceId, recordEvent],
  );

  const copyHash = useCallback(async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1200);
    } catch {
      // Clipboard can fail in non-secure contexts; swallow quietly.
    }
  }, []);

  if (git === null) return null;

  if (git === undefined) {
    return (
      <GitStatusTrigger
        git={git}
        open={open}
        compact={compact}
        onToggle={() => setOpen((v) => !v)}
        onOpenDiff={() => openDiffViewer(serviceId)}
      />
    );
  }

  const activeBranchList = branchTab === 'local' ? branches : remoteBranches;
  const filteredBranches = (() => {
    if (!activeBranchList) return null;
    const q = branchSearch.trim().toLowerCase();
    if (!q) return activeBranchList;
    return activeBranchList.filter((b) => b.toLowerCase().includes(q));
  })();
  const olderCommits = (recentCommits ?? []).slice(1, 1 + RECENT_COMMIT_LIMIT);

  const cancelAmend = () => {
    setAmending(false);
    setAmendMessage('');
    setErr(null);
  };

  const cancelCreate = () => {
    setCreating(false);
    setNewBranch('');
    setErr(null);
  };

  const actions: GitActionCallbacks = {
    onSync: () => void runSync(),
    onFetch: () => void run('fetch', () => ipc.gitFetch(serviceId)),
    onPull: () => void run('pull', () => ipc.gitPull(serviceId)),
    onPush: () => void run('push', () => ipc.gitPush(serviceId)),
    onStash: () =>
      void run('stash', async () => {
        const priorDirty = git.dirty_count;
        await ipc.gitStash(serviceId, null);
        recordEvent('git_stash', `Stashed ${priorDirty} change${priorDirty === 1 ? '' : 's'}`);
      }),
    onPop: () =>
      void run('pop', async () => {
        await ipc.gitStashPop(serviceId);
        recordEvent('git_stash', 'Popped most recent stash');
      }),
    onOpenSource: () => {
      setOpen(false);
      openDiffViewer(serviceId, git.is_dirty ? 'commit' : 'history');
    },
  };

  return (
    <>
      <div ref={wrapRef}>
        <GitStatusTrigger
          git={git}
          open={open}
          compact={compact}
          onToggle={() => setOpen((v) => !v)}
          onOpenDiff={() => openDiffViewer(serviceId)}
        />
      </div>

      {open && (
        <GitStatusPopover
          git={git}
          position={pos}
          busy={busy}
          error={err}
          amending={amending}
          amendMessage={amendMessage}
          copiedHash={copiedHash}
          olderCommits={olderCommits}
          recentExpanded={recentExpanded}
          branchState={{
            branches,
            remoteBranches,
            filteredBranches,
            branchTab,
            branchSearch,
            creating,
            newBranch,
          }}
          amendInputRef={amendInputRef}
          searchInputRef={searchInputRef}
          newBranchInputRef={newBranchInputRef}
          actions={actions}
          onClose={closePopover}
          onDismissError={() => setErr(null)}
          onOpenDiff={() => {
            setOpen(false);
            openDiffViewer(serviceId);
          }}
          onAmendMessageChange={setAmendMessage}
          onSubmitAmend={submitAmend}
          onCancelAmend={cancelAmend}
          onCopyHash={(hash) => void copyHash(hash)}
          onStartAmend={(message) => {
            setAmendMessage(message);
            setAmending(true);
          }}
          onRequestUndo={() => setConfirm({ kind: 'undo' })}
          onToggleRecent={() => setRecentExpanded((v) => !v)}
          onBranchSearchChange={setBranchSearch}
          onBranchTabChange={setBranchTab}
          onRequestCheckout={requestCheckout}
          onRequestDeleteBranch={(name) =>
            setConfirm({ kind: 'delete-branch', name, force: false })
          }
          onStartCreating={() => setCreating(true)}
          onNewBranchChange={setNewBranch}
          onSubmitNewBranch={() => void submitNewBranch()}
          onCancelCreate={cancelCreate}
        />
      )}

      <GitConfirmDialogs
        confirm={confirm}
        lastCommit={git.last_commit}
        onCancel={() => setConfirm(null)}
        onUndo={() => void run('undo', () => ipc.gitUndoLastCommit(serviceId))}
        onAmend={(message) => void performAmend(message)}
        onCheckout={performCheckout}
        onDeleteBranch={performDeleteBranch}
        onForceDeleteBranch={(name) => setConfirm({ kind: 'delete-branch', name, force: true })}
      />
    </>
  );
}
