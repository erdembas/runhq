import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { SetStateAction } from 'react';
import type { DetailTab } from '@/components/ProjectDetailDrawer';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import { buildWorkspaceFacts } from '@/lib/ai/workspaceSummary';
import { buildWorkspaceReportChatPayload } from '@/lib/ai/workspaceReportPayload';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import type { ProjectOverview, ServiceDef, StackDef } from '@/types';
import { buildDashboardGroups } from './grouping';
import {
  STALE_SCAN_THRESHOLD_MS,
  buildGitPredicate,
  buildServiceComparator,
  calculateAttentionStats,
  calculateGitStats,
  calculateStats,
  matchesAttentionFilter,
  searchScore,
  type AttentionFilter,
  type GitFilter,
  type ServiceOverlayKind,
} from './model';

export function useDashboardModel(onScan: () => void) {
  const allServices = useAppStore((s) => s.services);
  const showHidden = useAppStore((s) => s.dashboardShowHidden);
  const setShowHidden = useAppStore((s) => s.setDashboardShowHidden);
  const servicesLoaded = useAppStore((s) => s.servicesLoaded);
  const statuses = useAppStore((s) => s.statuses);
  const resources = useAppStore((s) => s.resources);
  const ports = useAppStore((s) => s.ports);
  const appVersion = useAppStore((s) => s.appVersion);
  const openEditor = useAppStore((s) => s.openEditor);
  const stacks = useAppStore((s) => s.stacks);
  const removeStack = useAppStore((s) => s.removeStack);
  const openStackEditor = useAppStore((s) => s.openStackEditor);
  const setSelectedStack = useAppStore((s) => s.setSelectedStack);
  const openServiceWithBodyTab = useAppStore((s) => s.openServiceWithBodyTab);
  const upsertStack = useAppStore((s) => s.upsertStack);
  const git = useAppStore((s) => s.git);
  const groupBy = useAppStore((s) => s.dashboardGroupBy);
  const setGroupBy = useAppStore((s) => s.setDashboardGroupBy);
  const sortBy = useAppStore((s) => s.dashboardSortBy);
  const setSortBy = useAppStore((s) => s.setDashboardSortBy);
  const sections = useAppStore((s) => s.sections);
  const serviceSection = useAppStore((s) => s.serviceSection);
  const overview = useAppStore((s) => s.overview);
  const overviewScanning = useAppStore((s) => s.overviewScanning);
  const setOverviewScanning = useAppStore((s) => s.setOverviewScanning);
  const patchOverviewScan = useAppStore((s) => s.patchOverviewScan);
  const patchScanEntry = useAppStore((s) => s.patchScanEntry);
  const setScanningService = useAppStore((s) => s.setScanningService);
  const scanFreshnessByService = useAppStore((s) => s.scanFreshnessByService);
  const lastScanAt = useAppStore((s) => s.lastScanAt);
  const editors = useAppStore((s) => s.editors);

  const services = useMemo(
    () => (showHidden ? allServices : allServices.filter((s) => !s.hide_dashboard)),
    [allServices, showHidden],
  );
  const hiddenCount = useMemo(
    () => allServices.reduce((n, s) => n + (s.hide_dashboard ? 1 : 0), 0),
    [allServices],
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (lastScanAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [lastScanAt]);

  const [gitFilter, setGitFilter] = useState<GitFilter>('all');
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('all');
  const [, startFilterTransition] = useTransition();
  const setGitFilterDeferred = useCallback((next: SetStateAction<GitFilter>) => {
    startFilterTransition(() => setGitFilter(next));
  }, []);
  const setAttentionFilterDeferred = useCallback((next: SetStateAction<AttentionFilter>) => {
    startFilterTransition(() => setAttentionFilter(next));
  }, []);

  const [committedQuery, setCommittedQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveQuery = committedQuery;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const [detail, setDetail] = useState<{ serviceId: string; tab: DetailTab } | null>(null);
  const openDetail = useCallback((serviceId: string, tab: DetailTab) => {
    setDetail({ serviceId, tab });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const [serviceOverlay, setServiceOverlay] = useState<{
    serviceId: string;
    kind: ServiceOverlayKind;
  } | null>(null);
  const openServiceOverlay = useCallback(
    (serviceId: string, kind: 'notes' | 'license') => {
      if (kind === 'notes') {
        openServiceWithBodyTab(serviceId, 'notes');
        return;
      }
      setServiceOverlay({ serviceId, kind });
    },
    [openServiceWithBodyTab],
  );
  const closeServiceOverlay = useCallback(() => setServiceOverlay(null), []);
  const overlayService = useMemo(() => {
    if (!serviceOverlay) return null;
    return services.find((s) => s.id === serviceOverlay.serviceId) ?? null;
  }, [serviceOverlay, services]);

  useEffect(() => {
    if (serviceOverlay && !overlayService) setServiceOverlay(null);
  }, [serviceOverlay, overlayService]);

  const projectMetaById = useMemo(() => {
    const map = new Map<string, ProjectOverview>();
    if (overview) for (const p of overview.projects) map.set(p.service_id, p);
    return map;
  }, [overview]);

  const runScan = useCallback(async () => {
    if (overviewScanning) return;
    setOverviewScanning(true);
    try {
      const result = await ipc.scanProjectDependencies(true);
      patchOverviewScan(result);
    } catch (err) {
      console.error('scan_project_dependencies failed', err);
    } finally {
      setOverviewScanning(false);
    }
  }, [overviewScanning, setOverviewScanning, patchOverviewScan]);

  const staleScanServiceIds = useMemo(() => {
    const ids: string[] = [];
    for (const svc of services) {
      const meta = projectMetaById.get(svc.id);
      if (!meta?.runtime) continue;
      const stamped = scanFreshnessByService.get(svc.id);
      if (stamped == null || now - stamped >= STALE_SCAN_THRESHOLD_MS) ids.push(svc.id);
    }
    return ids;
  }, [services, projectMetaById, scanFreshnessByService, now]);

  const runStaleRescan = useCallback(async () => {
    if (overviewScanning || staleScanServiceIds.length === 0) return;
    for (const id of staleScanServiceIds) {
      setScanningService(id, true);
      try {
        const entry = await ipc.scanProjectDependencyForService(id, true);
        patchScanEntry(entry);
      } catch (err) {
        console.warn('[Dashboard] stale rescan failed', { serviceId: id, err });
      } finally {
        setScanningService(id, false);
      }
    }
  }, [staleScanServiceIds, setScanningService, patchScanEntry, overviewScanning]);

  const openDetailProject = useMemo(
    () =>
      detail ? (overview?.projects.find((p) => p.service_id === detail.serviceId) ?? null) : null,
    [detail, overview],
  );
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const workspaceReport = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: () => {
      const facts = buildWorkspaceFacts({
        services,
        statuses,
        resources,
        git,
        listening_port_count: ports.length,
        overview,
      });
      const payload = buildWorkspaceReportChatPayload(facts);
      return {
        origin: 'dashboard_report',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
      };
    },
  });

  const stats = useMemo(() => calculateStats(services, statuses), [services, statuses]);
  const runningServiceIds = useMemo(() => {
    const out = new Set<string>();
    for (const svc of services) {
      const st = statuses[svc.id]?.status ?? 'stopped';
      if (st === 'running' || st === 'starting') out.add(svc.id);
    }
    return out;
  }, [services, statuses]);
  const totals = useMemo(() => {
    let cpu = 0;
    let mem = 0;
    for (const id of runningServiceIds) {
      const sample = resources[id];
      if (!sample) continue;
      cpu += sample.cpu_percent;
      mem += sample.memory_bytes;
    }
    return { cpu, mem };
  }, [runningServiceIds, resources]);

  const total = services.length;
  const gitStats = useMemo(() => calculateGitStats(services, git), [services, git]);
  const gitFilterFn = useMemo(() => buildGitPredicate(gitFilter), [gitFilter]);
  const attentionStats = useMemo(() => calculateAttentionStats(overview), [overview]);
  const attentionFilterFn = useCallback(
    (svc: ServiceDef) => matchesAttentionFilter(attentionFilter, svc, projectMetaById),
    [attentionFilter, projectMetaById],
  );

  const eligibleServices = useMemo(() => {
    const stackServiceIds = new Set(stacks.flatMap((st) => st.service_ids));
    return services.filter((svc) => !stackServiceIds.has(svc.id));
  }, [services, stacks]);

  const visibleServiceIds = useMemo<ReadonlySet<string> | null>(() => {
    const hasGit = gitFilter !== 'all';
    const hasAttention = attentionFilter !== 'all';
    const hasSearch = effectiveQuery !== '';
    if (!hasGit && !hasAttention && !hasSearch) return null;
    const hits = new Set<string>();
    for (const svc of services) {
      if (hasGit && !gitFilterFn(svc, git[svc.id])) continue;
      if (hasAttention && !attentionFilterFn(svc)) continue;
      if (hasSearch && searchScore(svc, effectiveQuery) === 0) continue;
      hits.add(svc.id);
    }
    return hits;
  }, [services, gitFilter, attentionFilter, effectiveQuery, gitFilterFn, attentionFilterFn, git]);

  const totalMatchedCount = visibleServiceIds === null ? services.length : visibleServiceIds.size;
  const comparator = useMemo(
    () =>
      buildServiceComparator({
        sortBy,
        projectMetaById,
        runningServiceIds,
        resources,
        effectiveQuery,
      }),
    [sortBy, projectMetaById, runningServiceIds, resources, effectiveQuery],
  );
  const sortedEligibleServices = useMemo(
    () => [...eligibleServices].sort(comparator),
    [eligibleServices, comparator],
  );
  const groups = useMemo(
    () =>
      buildDashboardGroups({
        groupBy,
        services: eligibleServices,
        statuses,
        sections,
        serviceSection,
        comparator,
      }),
    [eligibleServices, groupBy, statuses, sections, serviceSection, comparator],
  );

  const clearSearchInput = useCallback(() => {
    setCommittedQuery('');
    const el = searchInputRef.current;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  const clearFilters = useCallback(() => {
    clearSearchInput();
    setGitFilterDeferred('all');
    setAttentionFilterDeferred('all');
  }, [clearSearchInput, setGitFilterDeferred, setAttentionFilterDeferred]);

  const requestDeleteStack = useCallback(
    (stack: StackDef) => {
      setPendingConfirm({
        message: `Delete stack "${stack.name}"?`,
        onConfirm: async () => {
          setPendingConfirm(null);
          await ipc.removeStack(stack.id);
          removeStack(stack.id);
        },
      });
    },
    [removeStack],
  );

  const dropServiceOnStack = useCallback(
    async (stack: StackDef, serviceId: string) => {
      if (!serviceId || stack.service_ids.includes(serviceId)) return;
      const updated = { ...stack, service_ids: [...stack.service_ids, serviceId] };
      await ipc.updateStack(updated);
      upsertStack(updated);
    },
    [upsertStack],
  );
  const selectService = useCallback((id: string) => {
    useAppStore.getState().setSelected(id);
  }, []);

  return {
    allServices,
    appVersion,
    attentionFilter,
    attentionStats,
    clearFilters,
    closeDetail,
    closeServiceOverlay,
    detail,
    dropServiceOnStack,
    editors,
    effectiveQuery,
    gitFilter,
    gitStats,
    groups,
    groupBy,
    hiddenCount,
    lastScanAt,
    now,
    onScan,
    openDetail,
    openDetailProject,
    openEditor,
    openServiceOverlay,
    openStackEditor,
    overlayService,
    overview,
    overviewScanning,
    pendingConfirm,
    ports,
    projectMetaById,
    requestDeleteStack,
    resources,
    runScan,
    runStaleRescan,
    runningServiceIds,
    searchInputRef,
    services,
    servicesLoaded,
    serviceOverlay,
    setAttentionFilterDeferred,
    setCommittedQuery,
    setGitFilterDeferred,
    setGroupBy,
    setPendingConfirm,
    setSelectedStack,
    setShowHidden,
    setSortBy,
    selectService,
    showHidden,
    sortedEligibleServices,
    sortBy,
    stacks,
    staleScanServiceIds,
    stats,
    statuses,
    total,
    totals,
    totalMatchedCount,
    visibleServiceIds,
    workspaceReport,
  };
}

export type DashboardModel = ReturnType<typeof useDashboardModel>;
