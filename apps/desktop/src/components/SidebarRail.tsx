import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronsLeft, ChevronsRight, LayoutDashboard } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconButton } from '@/components/ui/IconButton';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { categoryForTags, CATEGORIES } from '@/lib/categories';
import { runtimeFromTags, inferRuntimeFromCmds, runtimeMeta, RUNTIMES } from '@/lib/runtimes';
import type { SectionId, Status } from '@/types';

import {
  WorkspaceHeader,
  CreateActionsFooter,
  SectionBlock,
  UnassignedBlock,
  SectionBody,
  FlatItems,
  ServiceRow,
  UNASSIGNED,
  COLLAPSED_W,
  MIN_W,
  MAX_W,
  DEFAULT_W,
  getActiveDrag,
} from './sidebar';
import type { ServiceGroup } from './sidebar';

export function SidebarRail() {
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);
  const selectedServiceId = useAppStore((s) => s.selectedServiceId);
  const selectedStackId = useAppStore((s) => s.selectedStackId);
  const categoryFilter = useAppStore((s) => s.categoryFilter);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const sidebarStatusFilter = useAppStore((s) => s.sidebarStatusFilter);
  const groupBy = useAppStore((s) => s.sidebarGroupBy);
  const search = useAppStore((s) => s.search);
  const setSelected = useAppStore((s) => s.setSelected);
  const removeServiceLocal = useAppStore((s) => s.removeService);
  const openEditor = useAppStore((s) => s.openEditor);
  const stacks = useAppStore((s) => s.stacks);
  const removeStackLocal = useAppStore((s) => s.removeStack);
  const openStackEditor = useAppStore((s) => s.openStackEditor);
  const setSelectedStack = useAppStore((s) => s.setSelectedStack);
  const sections = useAppStore((s) => s.sections);
  const serviceSection = useAppStore((s) => s.serviceSection);
  const stackSection = useAppStore((s) => s.stackSection);
  const collapsedSections = useAppStore((s) => s.collapsedSections);
  const toggleSectionCollapsed = useAppStore((s) => s.toggleSectionCollapsed);

  const [pinned, setPinned] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState(DEFAULT_W);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const expanded = pinned || hovered;

  useEffect(() => {
    const onDoc = (e: globalThis.DragEvent) => {
      if (getActiveDrag() == null) return;
      e.preventDefault();
    };
    document.addEventListener('dragover', onDoc);
    document.addEventListener('dragenter', onDoc);
    return () => {
      document.removeEventListener('dragover', onDoc);
      document.removeEventListener('dragenter', onDoc);
    };
  }, []);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizing.current = true;
      startX.current = e.clientX;
      startW.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const delta = e.clientX - startX.current;
    setWidth(Math.max(MIN_W, Math.min(MAX_W, startW.current + delta)));
  }, []);

  const onResizeEnd = useCallback(() => {
    resizing.current = false;
  }, []);

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((svc) => {
      const status: Status = statuses[svc.id]?.status ?? 'stopped';
      const isRunning = status === 'running' || status === 'starting';
      if (sidebarStatusFilter === 'running' && !isRunning) return false;
      if (sidebarStatusFilter === 'stopped' && isRunning) return false;

      const cat = categoryForTags(svc.tags);
      if (categoryFilter.length > 0 && !categoryFilter.includes(cat.key)) return false;

      if (runtimeFilter.length > 0) {
        const rt = runtimeFromTags(svc.tags) ?? inferRuntimeFromCmds(svc.cmds);
        if (rt == null || !runtimeFilter.includes(rt)) return false;
      }

      if (q) {
        const hay =
          `${svc.name} ${svc.cmds.map((c) => c.cmd).join(' ')} ${svc.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [services, statuses, sidebarStatusFilter, categoryFilter, runtimeFilter, search]);

  const servicesBySection = useMemo(() => {
    const map = new Map<SectionId, typeof services>();
    const validIds = new Set(sections.map((s) => s.id));
    for (const svc of filteredServices) {
      const assigned = serviceSection[svc.id];
      const key = assigned && validIds.has(assigned) ? assigned : UNASSIGNED;
      const bucket = map.get(key);
      if (bucket) bucket.push(svc);
      else map.set(key, [svc]);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [filteredServices, serviceSection, sections]);

  const stacksBySection = useMemo(() => {
    const map = new Map<SectionId, typeof stacks>();
    const validIds = new Set(sections.map((s) => s.id));
    for (const stack of stacks) {
      const assigned = stackSection[stack.id];
      const key = assigned && validIds.has(assigned) ? assigned : UNASSIGNED;
      const bucket = map.get(key);
      if (bucket) bucket.push(stack);
      else map.set(key, [stack]);
    }
    return map;
  }, [stacks, stackSection, sections]);

  const flatGroups = useMemo<ServiceGroup[]>(() => {
    if (groupBy === 'none') return [];

    if (groupBy === 'status') {
      const running: typeof services = [];
      const stopped: typeof services = [];
      for (const svc of filteredServices) {
        const st: Status = statuses[svc.id]?.status ?? 'stopped';
        if (st === 'running' || st === 'starting') running.push(svc);
        else stopped.push(svc);
      }
      running.sort((a, b) => a.name.localeCompare(b.name));
      stopped.sort((a, b) => a.name.localeCompare(b.name));
      const out: ServiceGroup[] = [];
      if (running.length > 0)
        out.push({
          key: 'running',
          label: 'Running',
          dot: 'bg-status-running',
          color: 'text-status-running',
          services: running,
        });
      if (stopped.length > 0)
        out.push({
          key: 'stopped',
          label: 'Stopped',
          dot: 'bg-fg-dim/50',
          color: 'text-fg-dim',
          services: stopped,
        });
      return out;
    }

    if (groupBy === 'runtime') {
      const byKey = new Map<string, ServiceGroup>();
      const seed = (key: string, label: string, color?: string) => {
        if (!byKey.has(key)) byKey.set(key, { key, label, color, services: [] });
      };
      for (const svc of filteredServices) {
        const rt = runtimeFromTags(svc.tags) ?? inferRuntimeFromCmds(svc.cmds) ?? 'other';
        const meta = runtimeMeta(rt);
        seed(rt, meta.label, meta.color);
        byKey.get(rt)!.services.push(svc);
      }
      for (const g of byKey.values()) g.services.sort((a, b) => a.name.localeCompare(b.name));
      const order = new Map<string, number>();
      RUNTIMES.forEach((r, i) => order.set(r.key, i));
      return [...byKey.values()].sort(
        (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999),
      );
    }

    const byKey = new Map<string, ServiceGroup>();
    for (const svc of filteredServices) {
      const c = categoryForTags(svc.tags);
      const existing = byKey.get(c.key);
      if (existing) existing.services.push(svc);
      else
        byKey.set(c.key, {
          key: c.key,
          label: c.label,
          dot: c.dot,
          color: c.color,
          services: [svc],
        });
    }
    for (const g of byKey.values()) g.services.sort((a, b) => a.name.localeCompare(b.name));
    const order = new Map<string, number>();
    CATEGORIES.forEach((c, i) => order.set(c.key, i));
    return [...byKey.values()].sort(
      (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999),
    );
  }, [filteredServices, statuses, groupBy]);

  const runningCount = services.filter(
    (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'running',
  ).length;

  const hiddenCount = services.length - filteredServices.length;
  const currentWidth = expanded ? width : COLLAPSED_W;
  const onHomeSelected = selectedServiceId === null && selectedStackId === null;
  const useSectionLayout = groupBy === 'none';
  const hasSections = sections.length > 0;

  return (
    <div
      className="chrome-gradient border-border/70 bg-surface-raised relative flex h-full shrink-0 flex-col border-r transition-all duration-200"
      style={{ width: currentWidth }}
      onMouseEnter={() => {
        if (!pinned) setHovered(true);
      }}
      onMouseLeave={() => {
        if (!pinned) setHovered(false);
      }}
    >
      <div data-tauri-drag-region className="flex items-center justify-between gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setSelectedStack(null);
          }}
          className={cn(
            'rounded-app-sm flex flex-1 items-center gap-2 px-1.5 py-1 transition',
            onHomeSelected ? 'text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          <span
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-[5px]',
              onHomeSelected ? 'bg-accent text-accent-fg' : 'bg-surface-muted text-fg-muted',
            )}
          >
            <LayoutDashboard className="h-3 w-3" />
          </span>
          {expanded && <span className="text-[13px] font-semibold tracking-tight">Dashboard</span>}
        </button>
        {expanded && (
          <IconButton
            label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
            icon={pinned ? <ChevronsLeft /> : <ChevronsRight />}
            size="xs"
            onClick={() => setPinned((v) => !v)}
          />
        )}
      </div>

      <div className="overlay-scroll min-h-0 flex-1 overflow-x-hidden">
        {expanded && (
          <WorkspaceHeader
            servicesCount={services.length}
            runningCount={runningCount}
            stacksCount={stacks.length}
          />
        )}

        {expanded && hiddenCount > 0 && (
          <div className="border-border/60 mx-3 mb-1 flex items-center gap-2 rounded-[6px] border border-dashed px-2 py-1">
            <span className="text-fg-dim text-[10.5px]">
              Showing {filteredServices.length} · {hiddenCount} hidden
            </span>
          </div>
        )}

        {!expanded && (
          <div className="flex flex-col items-center gap-1 py-2">
            {services.map((svc) => {
              const status: Status = statuses[svc.id]?.status ?? 'stopped';
              const selected = selectedServiceId === svc.id;
              const isRunning = status === 'running' || status === 'starting';
              return (
                <button
                  key={svc.id}
                  type="button"
                  title={svc.name}
                  onClick={() => setSelected(svc.id)}
                  className={cn(
                    'relative flex h-8 w-8 items-center justify-center transition',
                    selected && 'glow-ring',
                  )}
                >
                  {isRunning && (
                    <span className="bg-status-running/15 animate-pulse-dot absolute inset-0" />
                  )}
                  <span
                    className={cn(
                      'relative text-[11px] font-bold uppercase',
                      selected ? 'text-accent' : isRunning ? 'text-fg' : 'text-fg-muted',
                    )}
                  >
                    {svc.name.slice(0, 2)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {expanded && !useSectionLayout && flatGroups.length === 0 && (
          <div className="text-fg-dim px-3 py-6 text-center text-[12px]">
            {services.length === 0 ? 'No services yet.' : 'No matches for this filter.'}
          </div>
        )}

        {expanded &&
          !useSectionLayout &&
          flatGroups.map((group) => {
            const collapsed = collapsedGroups.has(group.key);
            return (
              <section key={group.key} className="animate-slide-in">
                <header
                  onClick={() =>
                    setCollapsedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                  className="hover:bg-surface-overlay/40 sticky top-0 z-10 flex cursor-pointer items-center gap-2 bg-transparent py-1 pr-4 pl-3 backdrop-blur-[2px]"
                >
                  <ChevronDown
                    className={cn(
                      'text-fg-dim h-3 w-3 transition-transform',
                      collapsed && '-rotate-90',
                    )}
                  />
                  {group.dot && (
                    <span className={cn('h-1.5 w-1.5 rounded-full', group.dot)} aria-hidden />
                  )}
                  <span
                    className={cn(
                      'text-[10.5px] font-semibold tracking-[0.14em] uppercase',
                      group.color ?? 'text-fg-dim',
                    )}
                  >
                    {group.label}
                  </span>
                  <span className="text-fg-dim bg-surface-muted rounded-app-sm ml-auto px-1.5 text-[10px] tabular-nums">
                    {group.services.length}
                  </span>
                </header>
                {!collapsed && (
                  <ul className="mx-2 my-1 space-y-0.5">
                    {group.services.map((svc) => (
                      <li key={svc.id}>
                        <ServiceRow
                          service={svc}
                          status={statuses[svc.id]?.status ?? 'stopped'}
                          pid={statuses[svc.id]?.pid ?? undefined}
                          selected={selectedServiceId === svc.id}
                          currentSectionId={serviceSection[svc.id] ?? null}
                          onSelect={() => setSelected(svc.id)}
                          onEdit={() => openEditor(svc)}
                          onDelete={() => {
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
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

        {expanded && useSectionLayout && (
          <>
            {!hasSections ? (
              <FlatItems
                stacks={stacks}
                services={[...filteredServices].sort((a, b) => a.name.localeCompare(b.name))}
                statuses={statuses}
                selectedServiceId={selectedServiceId}
                selectedStackId={selectedStackId}
                serviceSection={serviceSection}
                stackSection={stackSection}
                onSelectService={setSelected}
                onSelectStack={setSelectedStack}
                onEditService={openEditor}
                onDeleteService={(svc) => {
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
                onEditStack={openStackEditor}
                onDeleteStack={(stack) => {
                  setPendingConfirm({
                    message: `Delete stack "${stack.name}"?`,
                    onConfirm: async () => {
                      setPendingConfirm(null);
                      await ipc.removeStack(stack.id);
                      removeStackLocal(stack.id);
                    },
                  });
                }}
                emptyMessage={
                  services.length === 0 && stacks.length === 0
                    ? 'No services yet.'
                    : hiddenCount > 0
                      ? 'No matches for this filter.'
                      : undefined
                }
              />
            ) : (
              <>
                {sections.map((sec) => {
                  const secStacks = stacksBySection.get(sec.id) ?? [];
                  const secServices = servicesBySection.get(sec.id) ?? [];
                  const isCollapsed = !!collapsedSections[sec.id];
                  const runningIn =
                    secStacks.reduce(
                      (acc, st) =>
                        acc +
                        st.service_ids.filter((sid) => {
                          const s: Status = statuses[sid]?.status ?? 'stopped';
                          return s === 'running' || s === 'starting';
                        }).length,
                      0,
                    ) +
                    secServices.filter(
                      (svc) =>
                        (statuses[svc.id]?.status ?? 'stopped') === 'running' ||
                        (statuses[svc.id]?.status ?? 'stopped') === 'starting',
                    ).length;
                  const totalIn =
                    secStacks.reduce((a, st) => a + st.service_ids.length, 0) + secServices.length;
                  return (
                    <SectionBlock
                      key={sec.id}
                      section={sec}
                      collapsed={isCollapsed}
                      onToggle={() => toggleSectionCollapsed(sec.id)}
                      running={runningIn}
                      total={totalIn}
                    >
                      <SectionBody
                        stacks={secStacks}
                        services={secServices}
                        statuses={statuses}
                        selectedServiceId={selectedServiceId}
                        selectedStackId={selectedStackId}
                        serviceSection={serviceSection}
                        stackSection={stackSection}
                        onSelectService={setSelected}
                        onSelectStack={setSelectedStack}
                        onEditService={openEditor}
                        onDeleteService={(svc) => {
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
                        onEditStack={openStackEditor}
                        onDeleteStack={(stack) => {
                          setPendingConfirm({
                            message: `Delete stack "${stack.name}"?`,
                            onConfirm: async () => {
                              setPendingConfirm(null);
                              await ipc.removeStack(stack.id);
                              removeStackLocal(stack.id);
                            },
                          });
                        }}
                      />
                    </SectionBlock>
                  );
                })}

                <UnassignedBlock
                  collapsed={!!collapsedSections[UNASSIGNED]}
                  onToggle={() => toggleSectionCollapsed(UNASSIGNED)}
                  stacksCount={(stacksBySection.get(UNASSIGNED) ?? []).length}
                  servicesCount={(servicesBySection.get(UNASSIGNED) ?? []).length}
                >
                  <SectionBody
                    stacks={stacksBySection.get(UNASSIGNED) ?? []}
                    services={servicesBySection.get(UNASSIGNED) ?? []}
                    statuses={statuses}
                    selectedServiceId={selectedServiceId}
                    selectedStackId={selectedStackId}
                    serviceSection={serviceSection}
                    stackSection={stackSection}
                    onSelectService={setSelected}
                    onSelectStack={setSelectedStack}
                    onEditService={openEditor}
                    onDeleteService={(svc) => {
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
                    onEditStack={openStackEditor}
                    onDeleteStack={(stack) => {
                      setPendingConfirm({
                        message: `Delete stack "${stack.name}"?`,
                        onConfirm: async () => {
                          setPendingConfirm(null);
                          await ipc.removeStack(stack.id);
                          removeStackLocal(stack.id);
                        },
                      });
                    }}
                  />
                </UnassignedBlock>
              </>
            )}
          </>
        )}
      </div>

      {expanded && (
        <CreateActionsFooter
          onAddService={() => openEditor(null)}
          onAddStack={() => openStackEditor(null)}
        />
      )}

      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        className="group absolute top-0 right-0 bottom-0 z-20 w-2 cursor-col-resize"
      >
        <div className="group-hover:bg-accent/30 group-active:bg-accent/50 absolute top-0 right-0 bottom-0 w-[2px] transition-colors" />
      </div>
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
