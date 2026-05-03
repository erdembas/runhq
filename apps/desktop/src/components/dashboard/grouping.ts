import type { DashboardGroupBy } from '@/store/useAppStore';
import { categoryForTags, CATEGORIES } from '@/lib/categories';
import { inferRuntimeFromCmds, runtimeFromTags, runtimeMeta, RUNTIMES } from '@/lib/runtimes';
import { sectionColor } from '@/lib/sectionColors';
import type { Section, SectionId, ServiceDef, Status } from '@/types';
import { type DashGroup, UNASSIGNED } from './model';

export function buildDashboardGroups(args: {
  groupBy: DashboardGroupBy;
  services: ServiceDef[];
  statuses: Record<string, { status: Status }>;
  sections: Section[];
  serviceSection: Record<string, SectionId>;
  comparator: (a: ServiceDef, b: ServiceDef) => number;
}) {
  const { groupBy, services, statuses, sections, serviceSection, comparator } = args;
  if (groupBy === 'none') return buildSectionGroups(services, sections, serviceSection, comparator);
  if (groupBy === 'status') return buildStatusGroups(services, statuses, comparator);
  if (groupBy === 'runtime') return buildRuntimeGroups(services, comparator);
  return buildCategoryGroups(services, comparator);
}

function buildSectionGroups(
  services: ServiceDef[],
  sections: Section[],
  serviceSection: Record<string, SectionId>,
  comparator: (a: ServiceDef, b: ServiceDef) => number,
) {
  if (sections.length === 0) return [];
  const bySection = new Map<SectionId, ServiceDef[]>();
  const validIds = new Set(sections.map((s) => s.id));
  for (const svc of services) {
    const assigned = serviceSection[svc.id];
    const key = assigned && validIds.has(assigned) ? assigned : UNASSIGNED;
    bySection.set(key, [...(bySection.get(key) ?? []), svc]);
  }
  for (const list of bySection.values()) list.sort(comparator);
  const result: DashGroup[] = [];
  for (const sec of sections) {
    const svcs = bySection.get(sec.id);
    if (!svcs?.length) continue;
    const meta = sectionColor(sec.color);
    result.push({
      key: sec.id,
      label: sec.name,
      dotStyle: { backgroundColor: meta.solid },
      labelStyle: { color: meta.solid },
      services: svcs,
    });
  }
  const unassigned = bySection.get(UNASSIGNED);
  if (unassigned?.length) {
    result.push({ key: UNASSIGNED, label: 'Unassigned', services: unassigned });
  }
  return result;
}

function buildStatusGroups(
  services: ServiceDef[],
  statuses: Record<string, { status: Status }>,
  comparator: (a: ServiceDef, b: ServiceDef) => number,
) {
  const running: ServiceDef[] = [];
  const stopped: ServiceDef[] = [];
  for (const svc of services) {
    const st = statuses[svc.id]?.status ?? 'stopped';
    if (st === 'running' || st === 'starting') running.push(svc);
    else stopped.push(svc);
  }
  running.sort(comparator);
  stopped.sort(comparator);
  const out: DashGroup[] = [];
  if (running.length) {
    out.push({
      key: 'running',
      label: 'Running',
      dotClass: 'bg-status-running',
      labelClass: 'text-status-running',
      services: running,
    });
  }
  if (stopped.length) {
    out.push({
      key: 'stopped',
      label: 'Stopped',
      dotClass: 'bg-fg-dim/50',
      labelClass: 'text-fg-dim',
      services: stopped,
    });
  }
  return out;
}

function buildRuntimeGroups(
  services: ServiceDef[],
  comparator: (a: ServiceDef, b: ServiceDef) => number,
) {
  const byKey = new Map<string, DashGroup>();
  for (const svc of services) {
    const rt = runtimeFromTags(svc.tags) ?? inferRuntimeFromCmds(svc.cmds) ?? 'other';
    const meta = runtimeMeta(rt);
    const group = byKey.get(rt) ?? {
      key: rt,
      label: meta.label,
      labelClass: meta.color,
      services: [],
    };
    group.services.push(svc);
    byKey.set(rt, group);
  }
  for (const group of byKey.values()) group.services.sort(comparator);
  const order = new Map<string, number>();
  RUNTIMES.forEach((r, i) => order.set(r.key, i));
  return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
}

function buildCategoryGroups(
  services: ServiceDef[],
  comparator: (a: ServiceDef, b: ServiceDef) => number,
) {
  const byKey = new Map<string, DashGroup>();
  for (const svc of services) {
    const category = categoryForTags(svc.tags);
    const group = byKey.get(category.key) ?? {
      key: category.key,
      label: category.label,
      dotClass: category.dot,
      labelClass: category.color,
      services: [],
    };
    group.services.push(svc);
    byKey.set(category.key, group);
  }
  for (const group of byKey.values()) group.services.sort(comparator);
  const order = new Map<string, number>();
  CATEGORIES.forEach((c, i) => order.set(c.key, i));
  return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
}
