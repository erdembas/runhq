import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FoldVertical,
  FolderOpen,
  GitCommit,
  List,
  ListTree,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UnfoldVertical,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { type FileEntry, buildTree, collectFolderPaths, statusLetterStyle } from '@/lib/gitDiff';
import { useAppStore } from '@/store/useAppStore';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { TreeView } from '@/components/git/shared';
import { DiffPane, type DiffViewMode } from '@/components/git/DiffPane';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FileContextMenu, type FileContextMenuEntry } from '@/components/ui/FileContextMenu';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import type { DiffSummary, GitStatus, ServiceId } from '@/types';

interface CommitPanelProps {
  serviceId: ServiceId;
  cwd: string | null;
  monacoTheme: string;
  viewMode: DiffViewMode;
  /** Bumped by the parent after external refreshes (e.g. git status chip),
   * so every panel reloads in sync. */
  refreshTick: number;
  onAfterMutation: () => void;
}

type SelectedSource = { kind: 'staged' | 'unstaged'; path: string } | null;

export function CommitPanel({
  serviceId,
  cwd,
  monacoTheme,
  viewMode,
  refreshTick,
  onAfterMutation,
}: CommitPanelProps) {
  const [unstaged, setUnstaged] = useState<DiffSummary | null>(null);
  const [staged, setStaged] = useState<DiffSummary | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationMeta, setGenerationMeta] = useState<{
    provider: string;
    model: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedSource>(null);
  const [fileDiff, setFileDiff] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showStaged, setShowStaged] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [fileSearch, setFileSearch] = useState('');
  const [treeMode, setTreeMode] = useState<'tree' | 'list'>('tree');
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  // Right-click menu — opened by setting `ctxMenu` from FileRow's
  // onContextMenu handler. Holding the file + which side it was on so
  // the menu items can stage/unstage/discard correctly without having
  // to reach into the tree.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    file: FileEntry;
    side: 'staged' | 'unstaged';
  } | null>(null);

  // Discard confirmation. Two flavours:
  //   - tracked changes  → `git checkout HEAD -- path`        (irreversible but recoverable from reflog if needed)
  //   - untracked file   → filesystem deletion via `git clean` (irreversible AND not in any git history)
  // The untracked path uses a `confirmWord` gate to prevent muscle-memory.
  const [discardConfirm, setDiscardConfirm] = useState<{ file: FileEntry } | null>(null);

  const sidebar = useResizableWidth({
    storageKey: 'runhq.diff.commit.sidebar.v1',
    defaultWidth: 320,
    min: 320,
    max: 600,
  });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [u, s, st] = await Promise.all([
        ipc.gitDiff(serviceId),
        ipc.gitDiffStaged(serviceId),
        ipc.gitStatus(serviceId),
      ]);
      setUnstaged(u);
      setStaged(s);
      setGitStatus(st);
    } catch (err) {
      console.error('Failed to reload commit panel', err);
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshTick]);

  // Pre-fill message with the previous commit's subject when the user
  // turns on Amend. We only touch it if the box is empty so typed drafts
  // aren't clobbered.
  useEffect(() => {
    if (amend && gitStatus?.last_commit && message.trim() === '') {
      setMessage(gitStatus.last_commit.subject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amend]);

  // Build trees for each section. We keep `*EntriesAll` for stage/unstage
  // actions and counts-of-truth, while `*Entries` is the search-filtered
  // view used to drive the visible tree. Splitting the two means typing
  // into the search box never blocks "Stage all" — that always operates
  // on the full set, matching how VSCode behaves.
  const stagedEntriesAll: FileEntry[] = useMemo(
    () => staged?.files.map((f) => ({ ...f, section: 'Staged' })) ?? [],
    [staged],
  );
  const unstagedEntriesAll: FileEntry[] = useMemo(
    () => unstaged?.files.map((f) => ({ ...f, section: 'Changes' })) ?? [],
    [unstaged],
  );

  const fileSearchTrim = fileSearch.trim().toLowerCase();
  const matchPath = useCallback(
    (path: string) => fileSearchTrim === '' || path.toLowerCase().includes(fileSearchTrim),
    [fileSearchTrim],
  );
  const stagedEntries = useMemo(
    () => stagedEntriesAll.filter((f) => matchPath(f.path)),
    [stagedEntriesAll, matchPath],
  );
  const unstagedEntries = useMemo(
    () => unstagedEntriesAll.filter((f) => matchPath(f.path)),
    [unstagedEntriesAll, matchPath],
  );
  const stagedTree = useMemo(() => buildTree(stagedEntries), [stagedEntries]);
  const unstagedTree = useMemo(() => buildTree(unstagedEntries), [unstagedEntries]);

  // Auto-expand every folder when the visible set changes (data refresh
  // or search edit) — when typing a search query users want matches
  // visible immediately, no extra clicks.
  useEffect(() => {
    const set = new Set<string>();
    collectFolderPaths(stagedTree, set);
    collectFolderPaths(unstagedTree, set);
    setExpandedFolders(set);
  }, [stagedTree, unstagedTree]);

  const expandAll = useCallback(() => {
    const set = new Set<string>();
    collectFolderPaths(stagedTree, set);
    collectFolderPaths(unstagedTree, set);
    setExpandedFolders(set);
  }, [stagedTree, unstagedTree]);

  const collapseAll = useCallback(() => {
    setExpandedFolders(new Set());
  }, []);

  // Huge context for "Full file" view — see DiffViewer for rationale.
  const showUnchanged = useAppStore((s) => s.diffShowUnchanged);
  const fullFileContext = showUnchanged ? 100_000 : undefined;

  // Load selected file's diff (staged or working tree).
  useEffect(() => {
    if (!selected) {
      setFileDiff(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    (async () => {
      try {
        const raw =
          selected.kind === 'staged'
            ? await ipc.gitDiffFileStaged(serviceId, selected.path, fullFileContext)
            : await ipc.gitDiffFile(serviceId, selected.path, fullFileContext);
        if (!cancelled) setFileDiff(raw);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load file diff', err);
          setFileDiff(null);
        }
      } finally {
        if (!cancelled) setFileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, selected, fullFileContext]);

  const selectedMeta: FileEntry | null = useMemo(() => {
    if (!selected) return null;
    const list = selected.kind === 'staged' ? stagedEntriesAll : unstagedEntriesAll;
    return list.find((f) => f.path === selected.path) ?? null;
  }, [selected, stagedEntriesAll, unstagedEntriesAll]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const runMutation = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null);
      try {
        await fn();
        onAfterMutation();
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [onAfterMutation, reload],
  );

  const stageFile = useCallback(
    (path: string) => runMutation(() => ipc.gitStageFile(serviceId, path)),
    [serviceId, runMutation],
  );
  const unstageFile = useCallback(
    (path: string) => runMutation(() => ipc.gitUnstageFile(serviceId, path)),
    [serviceId, runMutation],
  );
  const stageAll = useCallback(
    () => runMutation(() => ipc.gitStageAll(serviceId)),
    [serviceId, runMutation],
  );
  const unstageAll = useCallback(
    () => runMutation(() => ipc.gitUnstageAll(serviceId)),
    [serviceId, runMutation],
  );
  const discardFile = useCallback(
    (path: string) => runMutation(() => ipc.gitDiscardFile(serviceId, path)),
    [serviceId, runMutation],
  );

  // ---- Context-menu helpers ----------------------------------------------
  // We try-catch around the clipboard call so a sandbox / permission error
  // can't crash the whole panel — silent failure is acceptable for a copy.
  const writeClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Clipboard write failed', err);
    }
  }, []);

  const absolutePath = useCallback(
    (relative: string) => (cwd ? `${cwd.replace(/\/+$/, '')}/${relative}` : relative),
    [cwd],
  );

  const parentDirAbsolute = useCallback(
    (relative: string) => {
      const abs = absolutePath(relative);
      const i = abs.lastIndexOf('/');
      return i > 0 ? abs.slice(0, i) : abs;
    },
    [absolutePath],
  );

  const buildContextMenu = useCallback(
    (file: FileEntry, side: 'staged' | 'unstaged'): FileContextMenuEntry[] => {
      const isUntracked = file.status === 'untracked';
      const isDeleted = file.status === 'deleted';
      const abs = absolutePath(file.path);
      const items: FileContextMenuEntry[] = [];

      // Open / reveal — disabled when the file is gone from the working
      // tree (deleted state). VSCode greys these out the same way.
      items.push({
        id: 'open',
        label: 'Open File',
        icon: <FileText size={12} />,
        disabled: isDeleted || !cwd,
        onClick: () => void ipc.openPath(abs),
      });
      items.push({
        id: 'reveal',
        label: 'Reveal in Folder',
        icon: <FolderOpen size={12} />,
        disabled: !cwd,
        onClick: () => void ipc.openPath(parentDirAbsolute(file.path)),
      });

      items.push({ id: 'sep-1', separator: true });

      items.push({
        id: 'copy-path',
        label: 'Copy Path',
        icon: <Copy size={12} />,
        disabled: !cwd,
        onClick: () => void writeClipboard(abs),
      });
      items.push({
        id: 'copy-rel',
        label: 'Copy Relative Path',
        icon: <Copy size={12} />,
        onClick: () => void writeClipboard(file.path),
      });

      items.push({ id: 'sep-2', separator: true });

      // Stage / Unstage — phrased exactly like VSCode so muscle memory
      // carries over. For deleted files we say "Stage Deletion" because
      // that's what's actually happening at the index level.
      if (side === 'staged') {
        items.push({
          id: 'unstage',
          label: isDeleted ? 'Unstage Deletion' : 'Unstage Changes',
          icon: <Minus size={12} />,
          onClick: () => void unstageFile(file.path),
        });
      } else {
        items.push({
          id: 'stage',
          label: isDeleted ? 'Stage Deletion' : isUntracked ? 'Stage File' : 'Stage Changes',
          icon: <Plus size={12} />,
          onClick: () => void stageFile(file.path),
        });

        items.push({ id: 'sep-3', separator: true });

        // Discard — kritik. We pop a ConfirmDialog. The dialog itself
        // upgrades to a typed-word gate for untracked files (filesystem
        // deletion that git can't recover from).
        items.push({
          id: 'discard',
          label: isUntracked ? 'Delete File' : isDeleted ? 'Restore File' : 'Discard Changes',
          icon: isUntracked ? <Trash2 size={12} /> : <Undo2 size={12} />,
          tone: isUntracked ? 'danger' : 'default',
          onClick: () => setDiscardConfirm({ file }),
        });
      }

      return items;
    },
    [absolutePath, cwd, parentDirAbsolute, stageFile, unstageFile, writeClipboard],
  );

  const canCommit =
    !committing && (message.trim().length > 0 || amend) && (stagedEntriesAll.length > 0 || amend);

  const commitNow = useCallback(async () => {
    if (!canCommit) return;
    setCommitting(true);
    setError(null);
    try {
      await ipc.gitCommit(serviceId, message.trim(), amend);
      setMessage('');
      setAmend(false);
      onAfterMutation();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [serviceId, message, amend, canCommit, onAfterMutation, reload]);

  // AI commit-message generator. Phase-5 of the AI Chat Hub plan
  // routes this through the right-side chat panel: we fetch the
  // staged diff + recent commits, hand them to `openAiChat` with the
  // `use_as_commit` action hook, and let the assistant stream into a
  // persistent conversation. The user picks the model in the panel,
  // can iterate ("make it imperative"), and clicks the action button
  // to fill the textarea — see the `runhq:ai-action:use-as-commit`
  // listener below.
  //
  // We deliberately keep `generating` state for the brief window
  // between click and chat-panel arrival so the button shows a
  // spinner — opening the panel is fast but fetching the staged
  // diff can take a beat on big stages.
  // Live refs for state values that the lazy `buildPayload` reads
  // — captures freshest values at click-time without re-binding the
  // hook on every keystroke.
  const messageHintRef = useRef(message);
  messageHintRef.current = message;
  const stagedCountRef = useRef(stagedEntriesAll.length);
  stagedCountRef.current = stagedEntriesAll.length;

  const {
    triggerRef: generateTriggerRef,
    onClick: generateMessage,
    popover: generatePopover,
  } = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: async () => {
      if (stagedCountRef.current === 0) {
        setError('Stage some changes first — there is nothing to summarise.');
        return null;
      }
      setGenerating(true);
      setError(null);
      try {
        const ctx = await ipc.aiCommitChatContext({ service_id: serviceId });
        const hint = messageHintRef.current.trim() || null;
        const recentBlock =
          ctx.recent_subjects.length > 0
            ? `Recent commit subjects on this branch (newest first):\n${ctx.recent_subjects
                .map((s) => `- ${s}`)
                .join('\n')}`
            : 'No recent commits available.';
        const branchPart = ctx.branch ? `Branch: \`${ctx.branch}\`` : 'Branch: (detached HEAD)';
        const hintPart = hint ? `User hint: "${hint}"` : 'No additional hint from the user.';
        const contextSystemMessage = [
          'User is asking the AI to draft a git commit message in RunHQ. Read the staged diff and write a concise Conventional-Commits-style message: a single subject line of <=72 chars (imperative, no trailing period), then an optional blank line and a wrap-72 body if context is needed. Reference real symbols from the diff. Never wrap the answer in code fences. The first character of your reply must be the start of the commit message.',
          '',
          branchPart,
          hintPart,
          '',
          recentBlock,
          '',
          'Staged diff:',
          '```diff',
          ctx.diff || '[no staged diff]',
          '```',
        ].join('\n');

        const summary = ctx.diff_truncated
          ? '(staged diff truncated for the model)'
          : `${stagedCountRef.current} staged file${stagedCountRef.current === 1 ? '' : 's'}`;

        return {
          origin: 'commit',
          title: ctx.branch ? `Commit · ${ctx.branch}` : 'Commit message',
          context: {
            kind: 'commit',
            service_id: serviceId,
            branch: ctx.branch,
            summary,
          },
          draftPrompt: hint
            ? `Write a commit message. Hint: ${hint}`
            : 'Write a commit message for the staged changes.',
          contextSystemMessage,
          actionHook: { kind: 'use_as_commit', service_id: serviceId },
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setGenerating(false);
      }
    },
  });

  /**
   * Listen for the action-hook dispatch from the chat panel. The
   * panel fires a `runhq:ai-action:use-as-commit` event when the
   * user clicks the "Use as commit message" button under an
   * assistant turn. We filter on `service_id` so a multi-window
   * future doesn't cross-pollinate (and so a parallel commit panel
   * for a different service ignores us).
   */
  useEffect(() => {
    const onUseAsCommit = (e: Event) => {
      const ce = e as CustomEvent<{ service_id: string; content: string }>;
      const detail = ce.detail;
      if (!detail || detail.service_id !== serviceId) return;
      const trimmed = detail.content.trim();
      if (!trimmed) return;
      setMessage(trimmed);
      setGenerationMeta({ provider: 'AI Chat', model: null });
      window.setTimeout(() => {
        const ta = messageRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(trimmed.length, trimmed.length);
        }
      }, 0);
    };
    window.addEventListener('runhq:ai-action:use-as-commit', onUseAsCommit);
    return () => window.removeEventListener('runhq:ai-action:use-as-commit', onUseAsCommit);
  }, [serviceId]);

  const pushNow = useCallback(async () => {
    setPushing(true);
    setError(null);
    try {
      await ipc.gitPush(serviceId, amend);
      onAfterMutation();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  }, [serviceId, amend, onAfterMutation, reload]);

  // Cmd/Ctrl+Enter commits from the message textarea.
  const onKeyDownMessage = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void commitNow();
    }
  };

  const ahead = gitStatus?.ahead ?? 0;
  const behind = gitStatus?.behind ?? 0;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: commit compose + file lists — resizable, 240–720px. */}
      <div
        className="border-border flex shrink-0 flex-col border-r"
        style={{ width: sidebar.width }}
      >
        {/* Compose */}
        <div className="border-border space-y-2 border-b px-3 py-3">
          <label className="text-fg/50 flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase">
            <span>Commit message</span>
            <span className="text-fg/30 tracking-normal normal-case">⌘ ↵ to commit</span>
          </label>
          <div className="relative">
            <textarea
              ref={messageRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={onKeyDownMessage}
              rows={3}
              placeholder={
                amend ? 'Amend previous commit message…' : 'Summary (first line) + optional body'
              }
              className="border-border bg-surface text-fg placeholder:text-fg/30 focus:border-accent/60 focus:ring-accent/20 w-full resize-y rounded border px-2 py-1.5 pr-8 font-mono text-[12px] leading-snug outline-none focus:ring-2"
            />
            {/* AI generate trigger — overlaid on the textarea's top-right
                corner. The pr-8 above keeps long lines from sliding under
                it. Title doubles as the regenerate hint when the textarea
                already has content (the value is forwarded as a "hint"
                to the model). */}
            <button
              ref={generateTriggerRef}
              type="button"
              onClick={() => generateMessage()}
              disabled={generating || stagedEntriesAll.length === 0}
              className={cn(
                'absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded transition',
                generating
                  ? 'text-accent bg-accent/15'
                  : 'text-fg/40 hover:text-accent hover:bg-accent/10',
                'disabled:cursor-not-allowed disabled:opacity-30',
              )}
              title={
                stagedEntriesAll.length === 0
                  ? 'Stage changes to generate a commit message'
                  : message.trim()
                    ? 'Regenerate using current text as a hint'
                    : 'Generate commit message with AI'
              }
            >
              {generating ? (
                <RefreshCw size={11} className="animate-spin" />
              ) : (
                <Sparkles size={11} />
              )}
            </button>
            {generatePopover}
          </div>
          {generationMeta && !generating && (
            <div className="text-fg/40 flex items-center gap-1 text-[10px]">
              <Sparkles size={9} className="text-accent/70" />
              <span>
                Generated by {generationMeta.provider}
                {generationMeta.model ? ` · ${generationMeta.model}` : ''}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-fg/70 hover:text-fg flex cursor-pointer items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={amend}
                onChange={(e) => setAmend(e.target.checked)}
                className="accent-accent"
              />
              Amend last commit
            </label>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => void commitNow()}
                disabled={!canCommit}
                className="bg-accent text-accent-fg hover:bg-accent-hover flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
                title="Commit (⌘↵)"
              >
                {committing ? (
                  <RefreshCw size={11} className="animate-spin" />
                ) : (
                  <GitCommit size={11} />
                )}
                Commit
              </button>
              <button
                onClick={() => void pushNow()}
                disabled={pushing || loading}
                className="border-border bg-surface text-fg/80 hover:bg-fg/10 hover:text-fg flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                title={
                  behind > 0
                    ? `Behind ${behind} — pull first`
                    : ahead > 0
                      ? `Push ${ahead} commit${ahead === 1 ? '' : 's'}`
                      : 'Push'
                }
              >
                {pushing ? <RefreshCw size={11} className="animate-spin" /> : <Upload size={11} />}
                Push
                {ahead > 0 && <span className="text-accent-fg/80 tabular-nums">↑{ahead}</span>}
                {behind > 0 && <span className="text-rose-400 tabular-nums">↓{behind}</span>}
              </button>
            </div>
          </div>
          {error && (
            <div className="rounded border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-400">
              {error}
            </div>
          )}
        </div>

        {/* Toolbar — tree/list, expand/collapse, status legend */}
        <div className="border-border flex items-center gap-1 border-b px-2 py-1">
          <button
            onClick={() => setTreeMode(treeMode === 'tree' ? 'list' : 'tree')}
            className="text-fg/50 hover:bg-fg/10 hover:text-fg rounded p-1 transition"
            title={treeMode === 'tree' ? 'Switch to flat list' : 'Switch to tree view'}
          >
            {treeMode === 'tree' ? <ListTree size={13} /> : <List size={13} />}
          </button>
          <button
            onClick={expandAll}
            disabled={treeMode !== 'tree'}
            className="text-fg/50 hover:bg-fg/10 hover:text-fg rounded p-1 transition disabled:opacity-30"
            title="Expand all"
          >
            <UnfoldVertical size={13} />
          </button>
          <button
            onClick={collapseAll}
            disabled={treeMode !== 'tree'}
            className="text-fg/50 hover:bg-fg/10 hover:text-fg rounded p-1 transition disabled:opacity-30"
            title="Collapse all"
          >
            <FoldVertical size={13} />
          </button>
          <span className="ml-auto" />
          <div className="flex items-center gap-1" title="Added · Modified · Deleted · Renamed">
            {(
              [
                ['added', 'A'],
                ['modified', 'M'],
                ['deleted', 'D'],
                ['renamed', 'R'],
              ] as const
            ).map(([status, letter]) => (
              <span
                key={status}
                className="inline-flex items-center justify-center font-bold tabular-nums"
                style={{
                  ...statusLetterStyle[status],
                  height: 13,
                  minWidth: 13,
                  borderRadius: 3,
                  paddingLeft: 2,
                  paddingRight: 2,
                  fontSize: 8,
                  lineHeight: 1,
                }}
              >
                {letter}
              </span>
            ))}
          </div>
        </div>

        {/* File search — substring on path, case-insensitive */}
        <div className="border-border border-b px-2 py-1.5">
          <div className="border-border bg-surface focus-within:border-accent/50 flex h-7 items-center gap-1.5 rounded border px-2 transition-colors">
            <Search size={11} className="text-fg/40 shrink-0" />
            <input
              type="text"
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
              placeholder="Search files…"
              spellCheck={false}
              className="text-fg placeholder:text-fg/30 min-w-0 flex-1 bg-transparent text-[11px] outline-none"
            />
            {fileSearch && (
              <button
                onClick={() => setFileSearch('')}
                className="text-fg/40 hover:text-fg shrink-0 cursor-pointer transition"
                title="Clear"
                type="button"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* File lists */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {/* Staged */}
          <SectionHeader
            title="Staged Changes"
            count={stagedEntries.length}
            totalCount={stagedEntriesAll.length}
            searching={fileSearchTrim.length > 0}
            expanded={showStaged}
            onToggle={() => setShowStaged((v) => !v)}
            actions={
              stagedEntriesAll.length > 0 && (
                <button
                  onClick={() => void unstageAll()}
                  className="text-fg/50 hover:text-fg hover:bg-fg/10 rounded p-1 transition"
                  title="Unstage all"
                >
                  <Minus size={11} />
                </button>
              )
            }
          />
          {showStaged && (
            <>
              {stagedEntriesAll.length === 0 && (
                <p className="text-fg/30 px-4 py-1.5 text-[11px]">Nothing staged</p>
              )}
              {stagedEntriesAll.length > 0 && stagedEntries.length === 0 && (
                <p className="text-fg/30 px-4 py-1.5 text-[11px]">No matches</p>
              )}
              {stagedEntries.length > 0 &&
                (treeMode === 'tree' ? (
                  <TreeView
                    node={stagedTree}
                    level={0}
                    expanded={expandedFolders}
                    onToggle={toggleFolder}
                    selectedFile={selected?.kind === 'staged' ? selected.path : null}
                    onSelect={(path) => setSelected({ kind: 'staged', path })}
                    compactStats
                    onContextMenuFile={(node, e) =>
                      node.file &&
                      setCtxMenu({
                        x: e.clientX,
                        y: e.clientY,
                        file: node.file,
                        side: 'staged',
                      })
                    }
                    renderFileAction={(node) =>
                      node.file ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void unstageFile(node.file!.path);
                          }}
                          className="text-fg/50 hover:bg-fg/10 hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
                          title="Unstage this file"
                          aria-label={`Unstage ${node.file.path}`}
                        >
                          <Minus size={12} strokeWidth={2.2} />
                        </button>
                      ) : null
                    }
                  />
                ) : (
                  stagedEntries
                    .slice()
                    .sort((a, b) => a.path.localeCompare(b.path))
                    .map((file) => {
                      const node = {
                        name: file.path,
                        fullPath: file.path,
                        type: 'file' as const,
                        children: [],
                        file,
                        additions: file.additions,
                        deletions: file.deletions,
                        fileCount: 1,
                        mixedStatus: false,
                        status: file.status,
                      };
                      return (
                        <TreeView
                          key={`staged:${file.path}`}
                          node={node}
                          level={0}
                          expanded={expandedFolders}
                          onToggle={toggleFolder}
                          selectedFile={selected?.kind === 'staged' ? selected.path : null}
                          onSelect={(path) => setSelected({ kind: 'staged', path })}
                          onContextMenuFile={(n, e) =>
                            n.file &&
                            setCtxMenu({
                              x: e.clientX,
                              y: e.clientY,
                              file: n.file,
                              side: 'staged',
                            })
                          }
                          compactStats
                          renderFileAction={(n) =>
                            n.file ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void unstageFile(n.file!.path);
                                }}
                                className="text-fg/50 hover:bg-fg/10 hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
                                title="Unstage this file"
                                aria-label={`Unstage ${n.file.path}`}
                              >
                                <Minus size={12} strokeWidth={2.2} />
                              </button>
                            ) : null
                          }
                        />
                      );
                    })
                ))}
            </>
          )}

          {/* Unstaged */}
          <div className="mt-2" />
          <SectionHeader
            title="Changes"
            count={unstagedEntries.length}
            totalCount={unstagedEntriesAll.length}
            searching={fileSearchTrim.length > 0}
            expanded={showChanges}
            onToggle={() => setShowChanges((v) => !v)}
            actions={
              unstagedEntriesAll.length > 0 && (
                <button
                  onClick={() => void stageAll()}
                  className="text-fg/50 hover:text-fg hover:bg-fg/10 rounded p-1 transition"
                  title="Stage all"
                >
                  <CheckSquare size={11} />
                </button>
              )
            }
          />
          {showChanges && (
            <>
              {unstagedEntriesAll.length === 0 && (
                <p className="text-fg/30 px-4 py-1.5 text-[11px]">
                  {loading ? 'Loading…' : 'No changes'}
                </p>
              )}
              {unstagedEntriesAll.length > 0 && unstagedEntries.length === 0 && (
                <p className="text-fg/30 px-4 py-1.5 text-[11px]">No matches</p>
              )}
              {unstagedEntries.length > 0 &&
                (treeMode === 'tree' ? (
                  <TreeView
                    node={unstagedTree}
                    level={0}
                    expanded={expandedFolders}
                    onToggle={toggleFolder}
                    selectedFile={selected?.kind === 'unstaged' ? selected.path : null}
                    onSelect={(path) => setSelected({ kind: 'unstaged', path })}
                    compactStats
                    onContextMenuFile={(node, e) =>
                      node.file &&
                      setCtxMenu({
                        x: e.clientX,
                        y: e.clientY,
                        file: node.file,
                        side: 'unstaged',
                      })
                    }
                    renderFileAction={(node) =>
                      node.file ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void stageFile(node.file!.path);
                          }}
                          className="text-fg/50 flex h-5 w-5 items-center justify-center rounded transition hover:bg-emerald-400/15 hover:text-emerald-400"
                          title="Stage this file"
                          aria-label={`Stage ${node.file.path}`}
                        >
                          <Plus size={12} strokeWidth={2.2} />
                        </button>
                      ) : null
                    }
                  />
                ) : (
                  unstagedEntries
                    .slice()
                    .sort((a, b) => a.path.localeCompare(b.path))
                    .map((file) => {
                      const node = {
                        name: file.path,
                        fullPath: file.path,
                        type: 'file' as const,
                        children: [],
                        file,
                        additions: file.additions,
                        deletions: file.deletions,
                        fileCount: 1,
                        mixedStatus: false,
                        status: file.status,
                      };
                      return (
                        <TreeView
                          key={`unstaged:${file.path}`}
                          node={node}
                          level={0}
                          expanded={expandedFolders}
                          onToggle={toggleFolder}
                          selectedFile={selected?.kind === 'unstaged' ? selected.path : null}
                          onSelect={(path) => setSelected({ kind: 'unstaged', path })}
                          onContextMenuFile={(n, e) =>
                            n.file &&
                            setCtxMenu({
                              x: e.clientX,
                              y: e.clientY,
                              file: n.file,
                              side: 'unstaged',
                            })
                          }
                          compactStats
                          renderFileAction={(n) =>
                            n.file ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void stageFile(n.file!.path);
                                }}
                                className="text-fg/50 flex h-5 w-5 items-center justify-center rounded transition hover:bg-emerald-400/15 hover:text-emerald-400"
                                title="Stage this file"
                                aria-label={`Stage ${n.file.path}`}
                              >
                                <Plus size={12} strokeWidth={2.2} />
                              </button>
                            ) : null
                          }
                        />
                      );
                    })
                ))}
            </>
          )}
        </div>
      </div>

      <ResizeHandle
        handleProps={sidebar.handleProps}
        dragging={sidebar.dragging}
        title="Drag to resize file explorer · double-click to reset"
      />

      {/* Right: diff of the selected file */}
      <div className="flex min-w-0 flex-1 flex-col">
        <DiffPane
          selectedFile={selected?.path ?? null}
          fileDiff={fileDiff}
          selectedMeta={selectedMeta}
          monacoTheme={monacoTheme}
          cwd={cwd}
          viewMode={viewMode}
          fileLoading={fileLoading}
          emptyLabel={
            stagedEntries.length + unstagedEntries.length === 0
              ? 'Working tree is clean. Nothing to commit.'
              : 'Select a file to view its changes'
          }
        />
      </div>

      {ctxMenu && (
        <FileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildContextMenu(ctxMenu.file, ctxMenu.side)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {discardConfirm &&
        (() => {
          const f = discardConfirm.file;
          const isUntracked = f.status === 'untracked';
          const isDeleted = f.status === 'deleted';
          // Three flavours of "discard". The labels and tone match what
          // the context-menu item said so the user never sees a
          // mismatched verb between menu and dialog.
          const title = isUntracked
            ? 'Delete untracked file?'
            : isDeleted
              ? 'Restore deleted file?'
              : 'Discard changes?';
          const message = isUntracked
            ? `This will permanently delete "${f.path}" from disk. Git never tracked it, so it cannot be recovered from history.`
            : isDeleted
              ? `Restore "${f.path}" from HEAD? The file will reappear in your working tree.`
              : `All uncommitted changes in "${f.path}" will be lost. This cannot be undone.`;
          return (
            <ConfirmDialog
              title={title}
              message={message}
              tone={isDeleted ? 'warning' : 'danger'}
              confirmLabel={isUntracked ? 'Delete File' : isDeleted ? 'Restore' : 'Discard Changes'}
              confirmWord={isUntracked ? 'delete' : undefined}
              onConfirm={() => {
                void discardFile(f.path);
                setDiscardConfirm(null);
                if (selected?.kind === 'unstaged' && selected.path === f.path) {
                  setSelected(null);
                  setFileDiff(null);
                }
              }}
              onCancel={() => setDiscardConfirm(null)}
            />
          );
        })()}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  count: number;
  /** Total before search-filter is applied. When the user types into the
   * search box we render the count chip as `matches/total` so it's
   * obvious how aggressive the filter is. */
  totalCount?: number;
  searching?: boolean;
  expanded: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
}

function SectionHeader({
  title,
  count,
  totalCount,
  searching,
  expanded,
  onToggle,
  actions,
}: SectionHeaderProps) {
  const Chev = expanded ? ChevronDown : ChevronRight;
  const showRatio = searching && typeof totalCount === 'number' && totalCount !== count;
  return (
    <div className="text-fg/60 flex items-center gap-1 px-2 py-1 text-[10px] font-semibold tracking-wider uppercase">
      <button
        onClick={onToggle}
        className="hover:text-fg flex min-w-0 flex-1 items-center gap-1 text-left transition"
      >
        <Chev size={11} className="text-fg/40" />
        <span>{title}</span>
        <span className="bg-fg/10 text-fg/60 rounded px-1 py-px text-[9px] tabular-nums">
          {showRatio ? `${count}/${totalCount}` : count}
        </span>
      </button>
      {actions}
    </div>
  );
}
