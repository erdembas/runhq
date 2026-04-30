import { memo, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  Globe,
  HelpCircle,
  History,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Scale,
  Square,
  Trash2,
} from 'lucide-react';
import type { DetailTab } from '@/components/ProjectDetailDrawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import { buildWhyChatPayload } from '@/lib/ai/whyPayload';
import {
  AuditChip,
  LicenseChip,
  OutdatedChip,
  licenseContaminationCount,
} from '@/components/dashboard/healthChips';
import { EditorDropdown } from '@/components/EditorDropdown';
import { GitStatusChip } from '@/components/GitStatusChip';
import { ResourceBadge } from '@/components/ResourceBadge';
import { Sparkline } from '@/components/Sparkline';
import { StatusDot } from '@/components/ui/StatusDot';
import { useAppStore, logKey } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { localUrl } from '@/lib/url';
import { runtimeFromTags, inferRuntimeFromCmds, runtimeMeta } from '@/lib/runtimes';
import type { ProjectOverview, ServiceDef, Status } from '@/types';

/**
 * Human-readable "how stale is this project?" label for the card badge.
 *
 * Rolled up to weeks / months / years because at 30+ days the specific
 * day count stops being useful — the point is "really old", not
 * precision. `45d idle` would technically fit but feels clinical;
 * `6w idle` rolls up the same span more comfortably.
 *
 * Returns a fallback `Stale` label when we can't compute an age
 * (missing timestamp, malformed date). Better to be honest that we
 * don't know than to show a synthetic zero.
 */
function staleLabel(lastActivity: string | null): string {
  if (!lastActivity) return 'Stale';
  try {
    const diffMs = Date.now() - new Date(lastActivity).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return 'Stale';
    const days = Math.floor(diffMs / 86_400_000);
    if (days >= 365) return `${Math.floor(days / 365)}y idle`;
    if (days >= 30) return `${Math.floor(days / 30)}mo idle`;
    if (days >= 7) return `${Math.floor(days / 7)}w idle`;
    return `${days}d idle`;
  } catch {
    return 'Stale';
  }
}

/**
 * "Scan freshness" thresholds, in ms. Values picked to match the
 * cadence the existing in-memory cache and dashboard-pulse already
 * use:
 *
 *   < 1h     → "fresh" (subtle, no recommendation)
 *   1h–24h   → "recent" (neutral muted, plain age label)
 *   24h–7d   → "aging" (amber tone, "consider rescanning")
 *   ≥ 7d     → "stale" (warning tone, "rescan recommended")
 *
 * The 24h threshold is deliberately lenient: pulling `npm audit` 12
 * times a day on a workspace with 30 services is wasteful, and most
 * advisory feeds publish at most once a day. 7d is the "you really
 * should rescan before shipping" line — beyond that the data is
 * basically a guess.
 */
const SCAN_AGING_MS = 24 * 60 * 60_000;
const SCAN_STALE_MS = 7 * 24 * 60 * 60_000;

function scanAgeLabel(scannedAtMs: number, now: number): string {
  const diff = Math.max(0, now - scannedAtMs);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / (7 * 86_400_000))}w ago`;
  return `${Math.floor(diff / (30 * 86_400_000))}mo ago`;
}

function ScanFreshnessChip({
  scannedAtMs,
  durationMs,
  rescanning,
  onRescan,
}: {
  scannedAtMs: number;
  durationMs: number | null;
  /** True while a per-project rescan is mid-flight. Swaps the
   *  history icon for a spinner and disables the click. */
  rescanning: boolean;
  /** Click handler — when supplied, the chip becomes a button so
   *  power users can rescan a single project without going through
   *  the workspace-wide CTA. */
  onRescan?: () => void;
}) {
  // Re-tick once per minute so the label rolls forward without
  // depending on the parent. A card-level interval is cheap because
  // the dashboard typically renders <50 cards and most stay mounted
  // for the lifetime of the session anyway.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const age = now - scannedAtMs;
  const tone =
    age >= SCAN_STALE_MS
      ? 'bg-tone-danger/10 text-tone-danger-fg'
      : age >= SCAN_AGING_MS
        ? 'bg-tone-warning/10 text-tone-warning-fg'
        : 'bg-fg-dim/10 text-fg-dim';
  const recommendation =
    age >= SCAN_STALE_MS
      ? ' — rescan recommended'
      : age >= SCAN_AGING_MS
        ? ' — consider rescanning'
        : '';

  const tooltip = rescanning
    ? 'Rescanning this project…'
    : `Last scanned ${new Date(scannedAtMs).toLocaleString()}${
        durationMs != null ? ` (took ${(durationMs / 1000).toFixed(1)}s)` : ''
      }${recommendation}${onRescan ? ' · click to rescan' : ''}`;

  const label = rescanning ? 'scanning…' : scanAgeLabel(scannedAtMs, now);

  const sharedClass = cn(
    'rounded-app-sm inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition',
    tone,
    onRescan && !rescanning && 'cursor-pointer hover:brightness-110',
    rescanning && 'opacity-70 cursor-wait',
  );

  if (onRescan) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!rescanning) onRescan();
        }}
        disabled={rescanning}
        className={sharedClass}
        title={tooltip}
        aria-label={tooltip}
      >
        {rescanning ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <History className="h-3 w-3" />
        )}
        {label}
      </button>
    );
  }

  return (
    <span
      className={sharedClass}
      title={tooltip}
      aria-label={`Last scanned ${scanAgeLabel(scannedAtMs, now)}`}
    >
      <History className="h-3 w-3" />
      {label}
    </span>
  );
}

/**
 * Tiny "+3" / "−1" badge attached to the audit/outdated chip when the
 * latest persisted scan saw a count change vs the prior one. Renders
 * `null` when the delta is zero or unavailable so it doesn't clutter
 * cards in steady state — the user only sees this badge when something
 * actually moved, which is exactly when they should care.
 */
function ScanDeltaBadge({ delta, severity }: { delta: number; severity: 'risk' | 'outdated' }) {
  if (delta === 0) return null;
  const sign = delta > 0 ? '+' : '';
  const isRise = delta > 0;
  // For risk (advisories), more is bad — red on rise, green on drop.
  // For outdated, more is also bad-ish but less alarming — amber on
  // rise, neutral on drop. Tones picked to match the dashboard's
  // existing severity palette without inventing new ones.
  const tone =
    severity === 'risk'
      ? isRise
        ? 'bg-tone-danger/15 text-tone-danger-fg'
        : 'bg-tone-success/15 text-tone-success-fg'
      : isRise
        ? 'bg-tone-warning/15 text-tone-warning-fg'
        : 'bg-fg-dim/10 text-fg-dim';
  const abs = Math.abs(delta);
  const noun =
    severity === 'risk'
      ? abs === 1
        ? 'advisory'
        : 'advisories'
      : abs === 1
        ? 'outdated package'
        : 'outdated packages';
  return (
    <span
      className={cn(
        'rounded-app-sm ml-0.5 inline-flex shrink-0 items-center px-1 py-0.5 text-[9px] font-bold tabular-nums',
        tone,
      )}
      title={`${sign}${delta} ${noun} since last scan`}
      aria-label={`${sign}${delta} since last scan`}
    >
      {sign}
      {delta}
    </span>
  );
}

function CardAction({
  title,
  onClick,
  tone,
  children,
}: {
  title: string;
  onClick: () => void;
  tone?: 'accent';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'accent'
      ? 'hover:bg-accent/10 hover:text-accent'
      : 'hover:bg-surface-muted hover:text-fg';
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'text-fg-dim flex h-7 w-7 items-center justify-center rounded-md transition',
        toneClass,
      )}
    >
      {children}
    </button>
  );
}

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
  const openEditor = useAppStore((s) => s.openEditor);
  const removeServiceLocal = useAppStore((s) => s.removeService);
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

  const flagCount = countAttentionFlags(projectMeta);

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

      {/*
        Health strip — ALWAYS rendered (with min-height) so cards in
        the same grid row share the same vertical rhythm even when
        their contents differ wildly (one card with 4 signals next to
        a clean Docker-only project no longer creates an asymmetric
        gap). The strip shows one of four states, top to bottom in
        priority:

          1. Signals firing → chip cluster + scan-state on the right
                              (the loud case — what most users come for).
          2. Clean + scanned → muted "All clear" line + freshness chip.
                              A tiny but intentional reward for projects
                              with no debt; reading it across a long
                              roster scans like a status sweep.
          3. Has runtime, never scanned → "Not yet scanned" hint
                              (educates users that a scan is the next
                              action; doesn't alarm because it's a
                              neutral tone).
          4. No runtime to scan (Docker-only, etc.) → a single quiet
                              em-dash placeholder. Nothing to act on,
                              but the strip keeps the same vertical
                              footprint so the cards align.

        We hoist the boolean checks above the JSX so the branching
        reads as a state ladder instead of a wall of inline `&&`s,
        which was the readability problem with the previous version.
      */}
      {(() => {
        const hasOutdatedChip = (projectMeta?.outdated?.total ?? 0) > 0;
        const hasAuditChip =
          (projectMeta?.audit
            ? projectMeta.audit.critical +
              projectMeta.audit.high +
              projectMeta.audit.medium +
              projectMeta.audit.low
            : 0) > 0;
        const hasLicenseChip = licenseContaminationCount(projectMeta?.license) > 0;
        const hasSignals =
          !!projectMeta?.is_stale ||
          hasOutdatedChip ||
          hasAuditChip ||
          hasLicenseChip ||
          (!!projectMeta && flagCount > 0);
        const isScanning = overviewScanning && !!projectMeta?.runtime;
        const showFreshness = scanFreshness != null && !!projectMeta?.runtime;
        const isRuntimeProject = !!projectMeta?.runtime;

        return (
          <div
            className="border-border/40 -mx-1 -mt-1 flex min-h-[28px] flex-wrap items-center gap-x-1.5 gap-y-1 border-b px-1 pb-2"
            onClick={(e) => e.stopPropagation()}
          >
            {hasSignals ? (
              <>
                {projectMeta?.is_stale && (
                  <span
                    className="bg-fg-dim/10 text-fg-dim rounded-app-sm inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                    title={
                      projectMeta.last_activity
                        ? `No activity since ${new Date(projectMeta.last_activity).toLocaleDateString()}`
                        : 'No activity recorded'
                    }
                  >
                    <Clock className="h-3 w-3" />
                    {staleLabel(projectMeta.last_activity)}
                  </span>
                )}
                {hasOutdatedChip && projectMeta?.outdated && onOpenDetail && (
                  <span className="inline-flex items-center">
                    <OutdatedChip
                      outdated={projectMeta.outdated}
                      onClick={() => onOpenDetail(svc.id, 'outdated')}
                    />
                    {scanDelta?.outdated != null && scanDelta.outdated !== 0 && (
                      <ScanDeltaBadge delta={scanDelta.outdated} severity="outdated" />
                    )}
                  </span>
                )}
                {hasAuditChip && projectMeta?.audit && onOpenDetail && (
                  <span className="inline-flex items-center">
                    <AuditChip
                      audit={projectMeta.audit}
                      onClick={() => onOpenDetail(svc.id, 'advisories')}
                    />
                    {scanDelta?.vulnerabilities != null && scanDelta.vulnerabilities !== 0 && (
                      <ScanDeltaBadge delta={scanDelta.vulnerabilities} severity="risk" />
                    )}
                  </span>
                )}
                {hasLicenseChip && projectMeta?.license && (
                  <LicenseChip
                    license={projectMeta.license}
                    onClick={() => onOpenOverlay?.(svc.id, 'license')}
                  />
                )}
                {projectMeta && flagCount > 0 && (
                  <WhyAskButton projectMeta={projectMeta} flagCount={flagCount} />
                )}
              </>
            ) : isRuntimeProject && showFreshness ? (
              <span
                className="text-tone-success-fg/80 inline-flex items-center gap-1 text-[10px] font-semibold tracking-tight"
                title="No outdated packages, no advisories, no stale activity"
              >
                <CheckCircle2 className="h-3 w-3" />
                All clear
              </span>
            ) : isRuntimeProject ? (
              <span
                className="text-fg-dim/80 inline-flex items-center gap-1 text-[10px] font-medium"
                title="No dependency scan recorded yet — run “Rescan deps” to surface CVEs and outdated packages"
              >
                <span aria-hidden className="bg-fg-dim/40 inline-block h-1 w-1 rounded-full" />
                Not yet scanned
              </span>
            ) : (
              <span
                className="text-fg-dim/50 inline-flex items-center gap-1 text-[10px] font-medium"
                title="This project has no language runtime detected — dependency scans don't apply"
              >
                <span aria-hidden>—</span>
                <span>No dependency tracking</span>
              </span>
            )}

            {/*
              Right-pinned scan-state cluster — freshness chip and
              active-scan spinner. Always sits on the right via
              `ml-auto` so the alignment is the same whether the
              left side carries 4 chips or just an "All clear" line.
              Spinner shows whenever the workspace-wide scan is
              touching this project; freshness chip shows whenever
              we have a recorded scan timestamp.
            */}
            {(isScanning || showFreshness) && (
              <div className="text-fg-dim ml-auto flex items-center gap-1">
                {isScanning && (
                  <span
                    className="inline-flex h-5 items-center px-1"
                    title="Dependency scan in progress for this project"
                    aria-label="Scanning dependencies"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </span>
                )}
                {showFreshness && (
                  <ScanFreshnessChip
                    scannedAtMs={scanFreshness!}
                    durationMs={scanDuration ?? null}
                    rescanning={isRescanningThis}
                    onRescan={projectMeta?.runtime ? handleRescan : undefined}
                  />
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div className="text-fg-muted min-h-[18px] truncate font-mono text-[11px]">
        {svc.cmds.length === 1
          ? svc.cmds[0]?.cmd
          : `${svc.cmds.length} commands · ${svc.cmds.map((c) => c.name).join(', ')}`}
      </div>

      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {isRunning ? (
          <button
            type="button"
            title="Stop"
            onClick={() => void ipc.stopService(svc.id)}
            className="bg-status-error/10 text-status-error hover:bg-status-error/20 border-status-error/25 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition"
          >
            <Square className="h-3 w-3" fill="currentColor" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            title="Start"
            onClick={() => void ipc.startService(svc.id)}
            className="bg-status-running/10 text-status-running hover:bg-status-running/20 border-status-running/25 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition"
          >
            <Play className="h-3 w-3" fill="currentColor" />
            Start
          </button>
        )}
        <CardAction title="Restart" onClick={() => void ipc.restartService(svc.id)}>
          <RotateCcw className="h-3.5 w-3.5" />
        </CardAction>
        <CardAction title="Edit" onClick={() => openEditor(svc)}>
          <Pencil className="h-3.5 w-3.5" />
        </CardAction>
        <CardAction
          title="Delete"
          onClick={() => {
            setPendingConfirm({
              message: `Delete "${svc.name}"?`,
              onConfirm: async () => {
                setPendingConfirm(null);
                await ipc.stopService(svc.id).catch(() => undefined);
                await ipc.removeService(svc.id);
                removeServiceLocal(svc.id);
              },
            });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </CardAction>
        <CardAction title="Open folder" onClick={() => void ipc.openPath(svc.cwd)}>
          <FolderOpen className="h-3.5 w-3.5" />
        </CardAction>
        <CardAction title="Project notes" onClick={() => onOpenOverlay?.(svc.id, 'notes')}>
          <FileText className="h-3.5 w-3.5" />
        </CardAction>
        <CardAction title="License compliance" onClick={() => onOpenOverlay?.(svc.id, 'license')}>
          <Scale className="h-3.5 w-3.5" />
        </CardAction>
        {svc.port != null && (
          <CardAction
            title={`Open ${localUrl(svc.port!)}`}
            onClick={() => void ipc.openUrl(localUrl(svc.port!))}
            tone="accent"
          >
            <Globe className="h-3.5 w-3.5" />
          </CardAction>
        )}
        {/*
          Right-aligned cluster in the action row — now holds only git
          and editor, both of which are interactive popovers (not
          "signals"). They belong with the action buttons semantically.
          Health chips (Dep / CVE / Stale) moved up to the header row.
        */}
        <div className="ml-auto flex items-center gap-1">
          <GitStatusChip serviceId={svc.id} compact />
          <EditorDropdown cwd={svc.cwd} cmds={svc.cmds} size="xs" />
        </div>
      </div>

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

/**
 * How many "attention" signals are firing on this project right now?
 * Drives the visibility of the inline "Why?" AI explainer chip — we
 * don't want to push users into the model for projects that look
 * clean (it would feel like noise and burn tokens for nothing).
 */
function countAttentionFlags(p: ProjectOverview | null | undefined): number {
  if (!p) return 0;
  let n = 0;
  if (p.is_stale) n += 1;
  if (p.git_status?.is_dirty) n += 1;
  if (p.outdated && p.outdated.total > 0) n += 1;
  if (p.audit) {
    const total = p.audit.critical + p.audit.high + p.audit.medium + p.audit.low;
    if (total > 0) n += 1;
  }
  // License contamination is bucketed alongside the other "needs
  // attention" axes — the AI "Why?" trigger uses this count as a
  // gate, and a project sitting on a strong-copyleft package is
  // exactly the kind of "Wait, why is this flagged?" question we
  // want the explainer to be primed for.
  if (licenseContaminationCount(p.license) > 0) n += 1;
  return n;
}

/**
 * "Why is this project flagged?" trigger — a thin AI-action button
 * that owns its own provider chooser popover. Extracted into a
 * sub-component because `useAiSurfaceTrigger` (the hook that drives
 * single-vs-multi model UX) can't be called conditionally inside
 * the parent's JSX, and the button itself only renders when the
 * project actually has flags.
 */
function WhyAskButton({
  projectMeta,
  flagCount,
}: {
  projectMeta: ProjectOverview;
  flagCount: number;
}) {
  const { triggerRef, onClick, popover } = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: () => {
      const payload = buildWhyChatPayload(projectMeta);
      return {
        origin: 'why',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
      };
    },
  });
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={`Ask AI: why is this project flagged? (${flagCount} signal${
          flagCount === 1 ? '' : 's'
        })`}
        aria-label="Explain why this project is flagged"
        className="rounded-app-sm border-accent/30 bg-accent/8 text-accent hover:bg-accent/15 inline-flex h-5 items-center gap-1 border px-1.5 text-[10px] font-semibold transition"
      >
        <HelpCircle className="h-3 w-3" />
        Why?
      </button>
      {popover}
    </>
  );
}
