import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Columns2,
  Rows2,
  GitBranch,
  GitCommit,
  GitGraph,
  History,
  RefreshCw,
} from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store/useAppStore';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
import { useTheme } from '@/lib/theme';
import { useMonacoTheme } from '@/lib/monacoTheme';
import { type DiffViewMode } from '@/components/git/DiffPane';
import { CommitPanel } from '@/components/git/CommitPanel';
import { BranchesPanel } from '@/components/git/BranchesPanel';
import { HistoryPanel } from '@/components/git/HistoryPanel';
import { GraphPanel } from '@/components/git/GraphPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { DiffSummary } from '@/types';

interface DiffViewerProps {
  serviceId: string;
  onClose: () => void;
  embedded?: boolean;
  visible?: boolean;
}

type Tab = 'commit' | 'branches' | 'history' | 'graph';

/** macOS overlays native traffic-lights on top of the window, so we need to
 * reserve ~76px on the left so nothing sits underneath them. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Width of the always-visible vertical activity-bar rail on the right
 *  edge, in pixels. Mirrors `RightActivityBar`'s `w-9` (Tailwind 2.25rem
 *  ≈ 36px). Hard-coded here instead of measured because the alternative
 *  (resize observer + ref) jitters during the first paint and the rail
 *  is statically sized; if anyone ever changes the rail width they'll
 *  flip both spots in the same commit. */
const RIGHT_RAIL_WIDTH = 36;

export function DiffViewer({
  serviceId,
  onClose,
  embedded = false,
  visible = true,
}: DiffViewerProps) {
  i18n.useLocale();
  // Default tab is "Commit" — the merged Changes + Commit view. Used to
  // be two separate tabs ("Changes" for browsing, "Commit" for staging
  // and committing) but they shared ~90% of the same data set, so the
  // browse-only flow now lives inside the commit workflow with the
  // staging buttons hidden until the user wants to act.
  //
  // Callers can override the landing tab via the store
  // (`openDiffViewer(serviceId, 'history')`); the dashboard card's git
  // popover uses this to land on History when the repo is clean — the
  // user explicitly opened the panel without any pending diff, so the
  // commit composer would just stare back empty.
  const initialTab = useAppStore((s) =>
    s.diffViewerServiceId === serviceId ? s.diffViewerInitialTab : undefined,
  );
  const projectRequest = useWorkbenchStore((s) => s.projectGitRequests[serviceId]);
  const [tab, setTab] = useState<Tab>((embedded ? projectRequest?.tab : initialTab) ?? 'commit');
  const appliedRequest = useRef(projectRequest?.revision ?? 0);
  useEffect(() => {
    if (
      !embedded ||
      !visible ||
      !projectRequest ||
      projectRequest.revision === appliedRequest.current
    )
      return;
    appliedRequest.current = projectRequest.revision;
    setTab(projectRequest.tab);
  }, [embedded, visible, projectRequest]);
  const visitedTabs = useRef(new Set<Tab>());
  visitedTabs.current.add(tab);

  // Repo-wide totals for the titlebar — independent of which tab the
  // user is currently looking at. Each panel maintains its own copy of
  // these for its internal lists; the duplication is intentional
  // (panels stay decoupled, single fetch per tab swap, refreshTick
  // keeps everything in sync).
  const [unstagedDiff, setUnstagedDiff] = useState<DiffSummary | null>(null);
  const [stagedDiff, setStagedDiff] = useState<DiffSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<DiffViewMode>('side-by-side');
  const [refreshTick, setRefreshTick] = useState(0);
  // Esc / X-button close goes through this confirm to avoid losing the
  // typed commit message (or anything else mid-edit) on a stray keypress.
  // Only triggered when no transient overlay is currently consuming Esc;
  // see the keydown handler below for the layered behaviour.
  const [closeConfirm, setCloseConfirm] = useState(false);

  const { effective: effectiveTheme } = useTheme();
  const monacoTheme = useMonacoTheme(effectiveTheme);

  const serviceCwd = useAppStore(
    (s) => s.services.find((svc) => svc.id === serviceId)?.cwd ?? null,
  );

  // Reserve space on the right for the global rail (Activity Bar + the
  // currently-open side panel, if any). Without this the diff viewer
  // covers the entire viewport and clicking "Explain" on a hunk pops
  // the AI panel *behind* the diff — the user never sees the streamed
  // answer until they close the diff. By chopping our right edge to
  // sit flush with the rail's left edge, the AI/Activity panel slides
  // in alongside the diff viewer instead of behind it.
  const rightPanel = useAppStore((s) => s.rightPanel);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const reservedRight = RIGHT_RAIL_WIDTH + (rightPanel ? rightPanelWidth : 0);

  // Layered Esc behaviour:
  //   1. If any transient overlay (context menu, confirm dialog, popover)
  //      is open inside the viewer, Esc belongs to *that* overlay — we
  //      bail out so its own listener can close it. We detect them via
  //      ARIA roles so any future overlay that follows the same
  //      convention (alertdialog / menu / dialog) is automatically
  //      respected.
  //   2. Otherwise, Esc pops the close-confirm dialog instead of
  //      tearing the viewer down on the spot. The previous behaviour
  //      (instant close) lost typed commit messages on a stray keypress
  //      and was reported as user-hostile.
  //
  // We deliberately do NOT preventDefault when bailing out, so the
  // overlay's listener can still see the event. When we do handle it we
  // preventDefault to keep Monaco / textareas from also seeing the Esc.
  useEffect(() => {
    if (!visible || embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const hasOverlay =
        document.querySelector(
          '[role="alertdialog"], [role="menu"], [role="dialog"], [role="listbox"]',
        ) !== null;
      if (hasOverlay) return;
      e.preventDefault();
      setCloseConfirm(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, embedded]);

  // Pull repo-wide totals on mount and on every refresh. The tab content
  // panels do their own loading; this fetch only feeds the titlebar.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [unstaged, staged] = await Promise.all([
          ipc.gitDiff(serviceId),
          ipc.gitDiffStaged(serviceId),
        ]);
        if (cancelled) return;
        setUnstagedDiff(unstaged);
        setStagedDiff(staged);
      } catch (err) {
        console.error('Failed to load diff totals', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, refreshTick, visible]);

  const totalAdditions = (unstagedDiff?.total_additions ?? 0) + (stagedDiff?.total_additions ?? 0);
  const totalDeletions = (unstagedDiff?.total_deletions ?? 0) + (stagedDiff?.total_deletions ?? 0);
  const totalFiles = (unstagedDiff?.files.length ?? 0) + (stagedDiff?.files.length ?? 0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  // Side-by-side / inline split is irrelevant for the Graph tab (no
  // diff editor there). Keep it visible elsewhere — the user has it as
  // muscle memory.
  const needsViewToggle = tab !== 'graph';

  const tabs: Array<{
    id: Tab;
    label: string;
    icon: typeof GitCommit;
    count?: number;
  }> = [
    { id: 'commit', label: i18n.t('Commit'), icon: GitCommit, count: totalFiles || undefined },
    { id: 'branches', label: i18n.t('Branches'), icon: GitBranch },
    { id: 'history', label: i18n.t('History'), icon: History },
    { id: 'graph', label: i18n.t('Graph'), icon: GitGraph },
  ];

  const tabNavigation = tabs.map((t) => {
    const isActive = tab === t.id;
    const Icon = t.icon;
    return (
      <button
        key={t.id}
        onClick={() => setTab(t.id)}
        className={cn(
          'relative flex h-full items-center gap-1.5 px-3 text-[12px] transition-colors',
          isActive ? 'text-fg' : 'text-fg/50 hover:text-fg',
        )}
      >
        <Icon size={13} />
        <span>{t.label}</span>
        {typeof t.count === 'number' && t.count > 0 && (
          <span className="bg-fg/10 text-fg/70 rounded px-1 py-px text-[9px] tabular-nums">
            {t.count}
          </span>
        )}
        {isActive && <span className="bg-accent absolute right-2 bottom-0 left-2 h-[2px]" />}
      </button>
    );
  });

  return (
    // `inset-0` minus the right rail so the right-side panels (AI /
    // Activity Timeline) and the activity bar stay visible while the
    // viewer is open. We deliberately do NOT block pointer events on
    // the reserved strip — the rail must remain interactive (toggle
    // panels, switch between AI and Activity) while the user diffs.
    <div
      className={
        embedded
          ? 'flex min-h-0 flex-1 items-stretch overflow-hidden'
          : 'fixed top-0 bottom-0 left-0 z-50 flex items-stretch justify-stretch bg-black/60 backdrop-blur-sm'
      }
      style={embedded ? undefined : { right: reservedRight }}
    >
      <div className="bg-surface-raised border-border flex h-full w-full flex-col overflow-hidden rounded-none border-0 shadow-2xl">
        {/* Titlebar — draggable on macOS so users can still reposition the
            window when the diff viewer is fullscreen (the OS traffic-lights
            sit on top of this row at coords 0-76). */}
        <div
          {...(isMac && !embedded ? { 'data-tauri-drag-region': true } : {})}
          className={cn(
            'border-border flex h-11 shrink-0 items-center justify-between gap-3 border-b pr-3',
            isMac && !embedded ? 'pl-[84px]' : 'pl-3',
          )}
        >
          {embedded ? (
            <div className="flex h-full min-w-0 items-center overflow-x-auto">{tabNavigation}</div>
          ) : (
            <div className="flex items-center gap-3">
              <GitBranch size={13} className="text-fg/50 shrink-0" />
              <h2 className="text-fg text-[13px] font-semibold tracking-tight whitespace-nowrap">
                {i18n.t('Source Control')}
              </h2>
              {!loading && (
                <>
                  <span className="bg-border/80 h-3 w-px shrink-0" />
                  <span className="text-fg/50 text-[11px] whitespace-nowrap tabular-nums">
                    {i18n.rich('{value1} file{plural3}', {
                      value1: <span className="text-fg/70">{totalFiles}</span>,
                      plural3: totalFiles === 1 ? '' : 's',
                    })}
                  </span>
                  <span className="text-[11px] whitespace-nowrap tabular-nums">
                    <span className="text-emerald-400">+{totalAdditions}</span>{' '}
                    <span className="text-rose-400">−{totalDeletions}</span>
                  </span>
                </>
              )}
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {needsViewToggle && (
              <div className="border-border bg-surface-muted flex items-center overflow-hidden rounded border">
                <button
                  onClick={() => setViewMode('side-by-side')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-[11px] transition',
                    viewMode === 'side-by-side'
                      ? 'bg-accent/20 text-accent'
                      : 'text-fg/50 hover:text-fg',
                  )}
                  title={i18n.t('Side-by-side view')}
                >
                  <Columns2 size={12} />
                  <span className="hidden sm:inline">{i18n.t('Split')}</span>
                </button>
                <button
                  onClick={() => setViewMode('inline')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-[11px] transition',
                    viewMode === 'inline' ? 'bg-accent/20 text-accent' : 'text-fg/50 hover:text-fg',
                  )}
                  title={i18n.t('Inline (unified) view')}
                >
                  <Rows2 size={12} />
                  <span className="hidden sm:inline">{i18n.t('Inline')}</span>
                </button>
              </div>
            )}
            <button
              onClick={refresh}
              className="text-fg/60 hover:bg-fg/10 hover:text-fg cursor-pointer rounded p-1 transition"
              title={i18n.t('Refresh')}
            >
              <RefreshCw size={13} />
            </button>
            {!embedded && (
              <button
                onClick={onClose}
                className="text-fg/60 hover:bg-fg/10 hover:text-fg cursor-pointer rounded p-1 transition"
                // X is a deliberate click — close immediately without
                // confirmation. Esc is the reflexive key (users hammer it
                // to dismiss popovers), so that path goes through the
                // close-confirm dialog. See the keydown handler above.
                title={i18n.t('Close')}
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {!embedded && (
          <div className="border-border flex h-9 shrink-0 items-center border-b px-2">
            {tabNavigation}
          </div>
        )}

        {/* Tab content */}
        {visitedTabs.current.has('commit') && (
          <div className={tab === 'commit' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <CommitPanel
              serviceId={serviceId}
              cwd={serviceCwd}
              monacoTheme={monacoTheme}
              viewMode={viewMode}
              refreshTick={refreshTick}
              onAfterMutation={refresh}
            />
          </div>
        )}

        {visitedTabs.current.has('branches') && (
          <div className={tab === 'branches' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <BranchesPanel
              serviceId={serviceId}
              cwd={serviceCwd}
              monacoTheme={monacoTheme}
              viewMode={viewMode}
              refreshTick={refreshTick}
            />
          </div>
        )}

        {visitedTabs.current.has('history') && (
          <div className={tab === 'history' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <HistoryPanel
              serviceId={serviceId}
              cwd={serviceCwd}
              monacoTheme={monacoTheme}
              viewMode={viewMode}
              refreshTick={refreshTick}
            />
          </div>
        )}

        {visitedTabs.current.has('graph') && (
          <div className={tab === 'graph' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <GraphPanel
              serviceId={serviceId}
              refreshTick={refreshTick}
              onSelectCommit={() => setTab('history')}
            />
          </div>
        )}
      </div>

      {visible && closeConfirm && (
        <ConfirmDialog
          title={i18n.t('Close Source Control?')}
          message={
            totalFiles > 0
              ? i18n.t(
                  'You have uncommitted work in this repo. Closing won’t lose anything on disk, but any unsent commit message will be discarded.',
                )
              : i18n.t('Close the Source Control window?')
          }
          tone="info"
          confirmLabel={i18n.t('Close')}
          cancelLabel={i18n.t('Stay')}
          onConfirm={() => {
            setCloseConfirm(false);
            onClose();
          }}
          onCancel={() => setCloseConfirm(false)}
        />
      )}
    </div>
  );
}
