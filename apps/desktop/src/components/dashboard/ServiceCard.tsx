import { memo, useState } from 'react';
import { EyeOff } from 'lucide-react';
import type { DetailTab } from '@/components/ProjectDetailDrawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ServiceCardActions } from '@/components/dashboard/service-card/ServiceCardActions';
import { ServiceCardHealthStrip } from '@/components/dashboard/service-card/ServiceCardHealthStrip';
import { ResourceBadge } from '@/components/ResourceBadge';
import { Sparkline } from '@/components/Sparkline';
import { StatusDot } from '@/components/ui/StatusDot';
import { useAppStore, logKey } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { runtimeFromTags, inferRuntimeFromCmds, runtimeMeta } from '@/lib/runtimes';
import type { ProjectOverview, ServiceDef, Status } from '@/types';

/**
 * The card's render is heavy: it pulls live status, resources, git
 * state, ports, and an AI trigger out of the global store on every
 * render. Without `memo` every keystroke in the dashboard search box
 * re-walks all those store selectors for *every* card on the page,
 * even cards whose props (the only inputs that actually changed for
 * them) haven't moved. `memo` short-circuits the no-op renders, which
 * is what makes a paste-replace ("frontend-v2" ➜ "belgehub") in the
 * search box land in a single frame instead of stuttering.
 *
 * Default shallow-prop comparison is the right call here because all
 * four props are stable references when nothing about that card has
 * changed:
 *   - `svc`            ← the canonical entry from the services array;
 *                        Zustand keeps the same identity across
 *                        unrelated state mutations.
 *   - `draggable`      ← a static boolean per render site.
 *   - `projectMeta`    ← `Map.get(svc.id)` from a memoised lookup map
 *                        in Dashboard, so identity-stable when the
 *                        underlying overview entry hasn't changed.
 *   - `onOpenDetail`   ← wrapped in `useCallback` upstream; one
 *                        identity for the whole Dashboard lifetime.
 *
 * Live status / resources / git / ports come from store subscriptions
 * inside the card itself, so they bypass the prop-equality check on
 * purpose — the card *should* re-render when its own data updates,
 * just not when an unrelated card three rows down changes.
 */
export const ServiceCard = memo(function ServiceCard({
  svc,
  draggable: cardDraggable,
  projectMeta,
  onOpenDetail,
  onOpenOverlay,
}: {
  svc: ServiceDef;
  draggable?: boolean;
  /**
   * Cross-project overview slice for this service (stale flag, outdated
   * counts, audit counts). Optional because the overview poll runs
   * lazily — the card renders fine without it, it just hides the
   * attention chips until the data arrives.
   */
  projectMeta?: ProjectOverview | null;
  /**
   * Called when the user clicks a dep / audit chip. Opens the shared
   * `ProjectDetailDrawer` on the requested tab. Dashboard owns the
   * drawer so it survives switching between cards without flicker.
   */
  onOpenDetail?: (serviceId: string, tab: DetailTab) => void;
  /**
   * Called when the user clicks one of the per-service overlay
   * actions on the card row (Notes / License). Dashboard owns the
   * overlay state and renders the drawer at the dashboard root —
   * same contract as `onOpenDetail`. Lifting state out of the card
   * matters because `ServiceCard` uses the `.glass` class
   * (`backdrop-filter` + `isolation`), which would otherwise create
   * a new containing block and clip the drawer's `position:
   * absolute inset-0` chrome to the card bounds. The drawer mounted
   * at the dashboard root scopes to the entire dashboard region
   * instead.
   */
  onOpenOverlay?: (serviceId: string, kind: 'notes' | 'license') => void;
}) {
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const statuses = useAppStore((s) => s.statuses);
  const setSelected = useAppStore((s) => s.setSelected);
  const logs = useAppStore((s) => s.logs);
  const resourceSample = useAppStore((s) => s.resources[svc.id]);
  const resourceHistory = useAppStore((s) => s.resourceHistory[svc.id]);
  const overviewScanning = useAppStore((s) => s.overviewScanning);
  // Per-project scan freshness & duration come from the
  // store-side maps that mirror the SQLite scan history. Selecting
  // each service's slot directly keeps the re-render scope tight —
  // unrelated cards don't re-render when one project's scan
  // finishes.
  const scanFreshness = useAppStore((s) => s.scanFreshnessByService.get(svc.id));
  const scanDuration = useAppStore((s) => s.scanDurationByService.get(svc.id));
  const scanDelta = useAppStore((s) => s.scanDeltasByService.get(svc.id));
  const isRescanningThis = useAppStore((s) => s.scanningServiceIds.has(svc.id));
  const patchScanEntry = useAppStore((s) => s.patchScanEntry);
  const setScanningService = useAppStore((s) => s.setScanningService);

  /**
   * Per-project rescan handler. Bypasses the in-memory cache (force=true)
   * because the only reason to manually trigger this from the card is
   * "I want fresh numbers right now"; if cached data was good enough,
   * the chip wouldn't have been clicked.
   *
   * Errors are logged but not surfaced as a blocking dialog — the
   * card stays on the previous (still-valid) numbers and the user
   * can click again. We deliberately don't toast either, because
   * scan failures are noisy at the workspace level (one project
   * having no `package.json` shouldn't pollute the UI of 30 others).
   */
  const handleRescan = async () => {
    if (isRescanningThis) return;
    setScanningService(svc.id, true);
    try {
      const entry = await ipc.scanProjectDependencyForService(svc.id, true);
      patchScanEntry(entry);
    } catch (err) {
      console.warn('[ServiceCard] rescan failed', { serviceId: svc.id, err });
    } finally {
      setScanningService(svc.id, false);
    }
  };
  const st: Status = statuses[svc.id]?.status ?? 'stopped';
  const isRunning = st === 'running' || st === 'starting';
  const logLines =
    svc.cmds.length > 0 ? (logs[logKey(svc.id, svc.cmds[0]!.name)]?.lines ?? []) : [];
  const tail = logLines.slice(-3);

  const runtimeKey = runtimeFromTags(svc.tags) ?? inferRuntimeFromCmds(svc.cmds);
  const runtime = runtimeKey ? runtimeMeta(runtimeKey) : null;

  return (
    <div
      draggable={cardDraggable}
      onDragStart={(e) => {
        if (!cardDraggable) return;
        e.dataTransfer.setData('application/x-service-id', svc.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      role="button"
      tabIndex={0}
      onClick={() => setSelected(svc.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setSelected(svc.id);
        }
      }}
      className={cn(
        'group/card glass relative flex flex-col gap-3 p-4 text-left transition-all duration-200',
        'hover:border-border-strong hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_rgb(0_0_0/0.25)]',
        isRunning && 'border-accent/35 shadow-[0_0_0_1px_rgb(var(--accent)/0.12)]',
        // Workspace-only project rendered while "Show Hidden" is on:
        // dial the surface back so a glance across the grid still
        // reads "these don't count toward the dashboard headline" —
        // even though they're temporarily visible. Border-dashed
        // borrows the convention used by Linear/Notion for "draft
        // / hidden / muted" rows; hover lifts back to full opacity
        // so the user can still inspect details without strain.
        svc.hide_dashboard && 'border-border/40 border-dashed opacity-60 hover:opacity-100',
      )}
    >
      {isRunning && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-4 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgb(var(--accent) / 0.4), transparent)',
          }}
        />
      )}

      {/*
        Card header — split into two horizontal strips with distinct
        purposes, instead of one cramped row that loses to truncation
        as soon as a project carries 3+ signals:

          Strip 1 — Identity         : status dot + name + tech tags
                                       (runtime / port). "What this
                                       service IS." Name owns the
                                       width, only kerns when truly
                                       very long. Tech tags pinned
                                       right because they're identity-
                                       adjacent (they describe the
                                       service, not its current health).

          Strip 2 — Health signals   : stale + outdated + audit + Why?
                                       on the left, scan freshness on
                                       the right. "What's going on
                                       with it RIGHT NOW." Renders
                                       only when at least one signal
                                       fires — a clean project has no
                                       second strip at all, which is
                                       intentional reward.

        This split was the difference between names like
        `belgehub-backend-api` getting truncated to `belge…` (with
        every chip stealing the eye) and being fully readable next
        to a clean Node tag.
      */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <StatusDot status={st} size="md" />
          <span className="text-fg truncate text-[13.5px] font-semibold tracking-tight">
            {svc.name}
          </span>
          {/*
            Hidden-from-dashboard marker. Renders only when the
            service is workspace-only AND visible on the dashboard
            (the "Show Hidden" toggle is on) — otherwise the card
            wouldn't be in the DOM to read this. Tiny eye-off icon
            sits next to the name so the viewer's first scan
            confirms "right, this card is here as a courtesy, not
            because it counts toward the workspace stats". Tooltip
            spells it out for users who haven't internalised the
            convention yet.
          */}
          {svc.hide_dashboard && (
            <span
              className="text-fg-dim/70 inline-flex shrink-0"
              title="Hidden from dashboard headline (workspace-tracking only)"
              aria-label="Hidden from dashboard"
            >
              <EyeOff className="h-3 w-3" />
            </span>
          )}
        </div>
        {(runtime || svc.port != null) && (
          <div className="flex shrink-0 items-center gap-1">
            {runtime && (
              <span
                className={cn(
                  'rounded-app-sm px-1.5 py-0.5 text-[10px] font-semibold',
                  runtime.bg,
                  runtime.color,
                )}
              >
                {runtime.label}
              </span>
            )}
            {svc.port != null && (
              <span className="bg-accent/10 text-accent rounded-app-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                :{svc.port}
              </span>
            )}
          </div>
        )}
      </div>

      <ServiceCardHealthStrip
        serviceId={svc.id}
        projectMeta={projectMeta}
        overviewScanning={overviewScanning}
        scanFreshness={scanFreshness}
        scanDuration={scanDuration}
        scanDelta={scanDelta}
        isRescanning={isRescanningThis}
        onRescan={handleRescan}
        onOpenDetail={onOpenDetail}
        onOpenOverlay={onOpenOverlay}
      />

      <div className="text-fg-muted min-h-[18px] truncate font-mono text-[11px]">
        {svc.cmds.length === 1
          ? svc.cmds[0]?.cmd
          : `${svc.cmds.length} commands · ${svc.cmds.map((c) => c.name).join(', ')}`}
      </div>

      <ServiceCardActions
        svc={svc}
        isRunning={isRunning}
        setPendingConfirm={setPendingConfirm}
        onOpenOverlay={onOpenOverlay}
      />

      {isRunning && (
        <div className="border-border/60 -mx-1 flex items-center justify-between gap-2 border-t pt-2">
          <ResourceBadge sample={resourceSample} />
          <Sparkline data={resourceHistory} width={100} height={24} />
        </div>
      )}

      {tail.length > 0 && (
        <div className="relative -mx-1 mt-1 -mb-1 overflow-hidden rounded-md bg-[rgb(var(--surface)/0.5)] px-3 pt-2 pb-1 font-mono">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-[rgb(var(--surface-raised)/0.9)] to-transparent"
          />
          {tail.map((line, i) => (
            <div
              key={i}
              className={cn(
                'truncate text-[11px] leading-[16px]',
                i === tail.length - 1 ? 'text-fg-muted' : 'text-fg-dim',
                line.stream === 'stderr' && 'text-status-error/70',
              )}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
});
