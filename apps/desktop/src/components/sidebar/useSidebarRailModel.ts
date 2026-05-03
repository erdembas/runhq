import { useMemo } from 'react';
import { categoryForTags, CATEGORIES } from '@/lib/categories';
import { inferRuntimeFromCmds, runtimeFromTags, runtimeMeta, RUNTIMES } from '@/lib/runtimes';
import type { SidebarGroupBy, SidebarStatusFilter } from '@/store/appStoreTypes';
import type { Section, SectionId, ServiceDef, ServiceStatus, StackDef, Status } from '@/types';
import { itemKey, UNASSIGNED, type ServiceGroup } from './dnd';
import type { SidebarItem } from './SectionBody';

interface UseSidebarRailModelArgs {
  services: ServiceDef[];
  statuses: Record<string, ServiceStatus>;
  stacks: StackDef[];
  categoryFilter: string[];
  runtimeFilter: string[];
  sidebarStatusFilter: SidebarStatusFilter;
  groupBy: SidebarGroupBy;
  search: string;
  sections: Section[];
  serviceSection: Record<string, SectionId>;
  stackSection: Record<string, SectionId>;
  sectionItemOrder: Record<string, string[]>;
}

export function useSidebarRailModel({
  services,
  statuses,
  stacks,
  categoryFilter,
  runtimeFilter,
  sidebarStatusFilter,
  groupBy,
  search,
  sections,
  serviceSection,
  stackSection,
  sectionItemOrder,
}: UseSidebarRailModelArgs) {
  const serviceIdsInAnyStack = useMemo(() => {
    const ids = new Set<string>();
    for (const stack of stacks) for (const sid of stack.service_ids) ids.add(sid);
    return ids;
  }, [stacks]);

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((svc) => {
      if (serviceIdsInAnyStack.has(svc.id)) return false;
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
  }, [
    services,
    statuses,
    sidebarStatusFilter,
    categoryFilter,
    runtimeFilter,
    search,
    serviceIdsInAnyStack,
  ]);

  const itemsBySection = useMemo(() => {
    const validIds = new Set(sections.map((s) => s.id));
    const buckets = new Map<SectionId, SidebarItem[]>();
    const push = (bucket: SectionId, item: SidebarItem) => {
      const list = buckets.get(bucket);
      if (list) list.push(item);
      else buckets.set(bucket, [item]);
    };
    for (const stack of stacks) {
      const assigned = stackSection[stack.id];
      const bucket = assigned && validIds.has(assigned) ? assigned : UNASSIGNED;
      push(bucket, { kind: 'stack', ref: stack });
    }
    for (const svc of filteredServices) {
      const assigned = serviceSection[svc.id];
      const bucket = assigned && validIds.has(assigned) ? assigned : UNASSIGNED;
      push(bucket, { kind: 'service', ref: svc });
    }
    for (const [bucket, list] of buckets) {
      const hint = sectionItemOrder[bucket] ?? [];
      if (hint.length === 0) {
        list.sort((a, b) => a.ref.name.localeCompare(b.ref.name));
        continue;
      }
      const indexFor = new Map<string, number>();
      hint.forEach((key, index) => indexFor.set(key, index));
      list.sort((a, b) => {
        const ia = indexFor.get(itemKey(a.kind, a.ref.id));
        const ib = indexFor.get(itemKey(b.kind, b.ref.id));
        if (ia != null && ib != null) return ia - ib;
        if (ia != null) return -1;
        if (ib != null) return 1;
        return a.ref.name.localeCompare(b.ref.name);
      });
    }
    return buckets;
  }, [filteredServices, stacks, serviceSection, stackSection, sections, sectionItemOrder]);

  const totalsBySection = useMemo(() => {
    const out = new Map<SectionId, { running: number; total: number }>();
    for (const [bucket, list] of itemsBySection) {
      let running = 0;
      let total = 0;
      for (const item of list) {
        if (item.kind === 'stack') {
          total += item.ref.service_ids.length;
          running += item.ref.service_ids.filter((sid) => {
            const st: Status = statuses[sid]?.status ?? 'stopped';
            return st === 'running' || st === 'starting';
          }).length;
        } else {
          total += 1;
          const st: Status = statuses[item.ref.id]?.status ?? 'stopped';
          if (st === 'running' || st === 'starting') running += 1;
        }
      }
      out.set(bucket, { running, total });
    }
    return out;
  }, [itemsBySection, statuses]);

  const flatGroups = useMemo<ServiceGroup[]>(() => {
    if (groupBy === 'none') return [];
    if (groupBy === 'status') return groupByStatus(filteredServices, statuses);
    if (groupBy === 'runtime') return groupByRuntime(filteredServices);
    return groupByCategory(filteredServices);
  }, [filteredServices, statuses, groupBy]);

  const runningCount = services.filter(
    (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'running',
  ).length;
  const hiddenCount = services.length - serviceIdsInAnyStack.size - filteredServices.length;

  return {
    filteredServices,
    itemsBySection,
    totalsBySection,
    flatGroups,
    runningCount,
    hiddenCount,
  };
}

function groupByStatus(services: ServiceDef[], statuses: Record<string, ServiceStatus>) {
  const running: ServiceDef[] = [];
  const stopped: ServiceDef[] = [];
  for (const svc of services) {
    const st: Status = statuses[svc.id]?.status ?? 'stopped';
    if (st === 'running' || st === 'starting') running.push(svc);
    else stopped.push(svc);
  }
  running.sort((a, b) => a.name.localeCompare(b.name));
  stopped.sort((a, b) => a.name.localeCompare(b.name));
  const out: ServiceGroup[] = [];
  if (running.length > 0) {
    out.push({
      key: 'running',
      label: 'Running',
      dot: 'bg-status-running',
      color: 'text-status-running',
      services: running,
    });
  }
  if (stopped.length > 0) {
    out.push({
      key: 'stopped',
      label: 'Stopped',
      dot: 'bg-fg-dim/50',
      color: 'text-fg-dim',
      services: stopped,
    });
  }
  return out;
}

function groupByRuntime(services: ServiceDef[]) {
  const byKey = new Map<string, ServiceGroup>();
  const seed = (key: string, label: string, color?: string) => {
    if (!byKey.has(key)) byKey.set(key, { key, label, color, services: [] });
  };
  for (const svc of services) {
    const rt = runtimeFromTags(svc.tags) ?? inferRuntimeFromCmds(svc.cmds) ?? 'other';
    const meta = runtimeMeta(rt);
    seed(rt, meta.label, meta.color);
    byKey.get(rt)!.services.push(svc);
  }
  for (const group of byKey.values()) group.services.sort((a, b) => a.name.localeCompare(b.name));
  const order = new Map<string, number>();
  RUNTIMES.forEach((runtime, index) => order.set(runtime.key, index));
  return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
}

function groupByCategory(services: ServiceDef[]) {
  const byKey = new Map<string, ServiceGroup>();
  for (const svc of services) {
    const category = categoryForTags(svc.tags);
    const existing = byKey.get(category.key);
    if (existing) existing.services.push(svc);
    else {
      byKey.set(category.key, {
        key: category.key,
        label: category.label,
        dot: category.dot,
        color: category.color,
        services: [svc],
      });
    }
  }
  for (const group of byKey.values()) group.services.sort((a, b) => a.name.localeCompare(b.name));
  const order = new Map<string, number>();
  CATEGORIES.forEach((category, index) => order.set(category.key, index));
  return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
}
