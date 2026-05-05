'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Layers, Plus, SlidersHorizontal } from 'lucide-react';
import type { ServiceDef, ServiceId, StackDef, Status } from '@runhq/cockpit-types';
import { cn } from '../lib/cn';
import { formatBytes, formatPercent } from '../lib/format';
import { cpuToneClass, memoryToneClass } from '../lib/resourceTone';
import { RuntimeBadge, type RuntimeBadgeKey } from './RuntimeBadge';
import { StatusDot } from './StatusDot';

export interface SidebarStackItem {
  stack: StackDef;
  /** Pre-computed `running` count for the stack — site fixtures
   *  supply this directly, the desktop wrapper derives it from the
   *  live status map. */
  running: number;
  /** Total service count for the stack. */
  total: number;
}

export interface SidebarSection {
  /** `null` represents the synthetic "Unassigned" group rendered at
   *  the bottom of the sidebar. The desktop's section model uses a
   *  real id; the marketing rail collapses everything without a
   *  section into one bucket so visitors don't see an empty Sections
   *  pane. */
  id: string | null;
  /** Display name. */
  name: string;
  /** Tone for the leading section bullet — mirrors the desktop's
   *  fixed-palette section colors. */
  color?: 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'cyan' | 'yellow' | 'slate';
  /** Service ids to render inside this section, in order. */
  serviceIds: ServiceId[];
}

interface Props {
  /** Service registry — key is `service.id`. */
  services: ServiceDef[];
  /** Section grouping. When omitted, the sidebar renders a single
   *  flat list (loop-section style). */
  sections?: SidebarSection[];
  /** Optional Stacks group rendered above the section list. */
  stacks?: SidebarStackItem[];
  /** Live (or fixture) status map keyed by service id. Missing entries
   *  render as `stopped`. */
  statuses: Record<ServiceId, Status>;
  /** Optional per-service resource sample. When present each row
   *  surfaces a CPU% + RSS pair (sized to fit at the row's right
   *  edge). */
  samples?: Record<ServiceId, import('@runhq/cockpit-types').ResourceSample | undefined>;
  /** Optional per-service runtime — drives the small uppercase tag
   *  (e.g. `GO`, `DOCKER`, `NODE`) shown to the right of the row's
   *  name. */
  runtimes?: Record<ServiceId, RuntimeBadgeKey>;
  /** Currently-selected service id. Drives the highlighted row. */
  selectedServiceId?: ServiceId | null;
  /** Currently-selected stack id. Mutually exclusive with
   *  `selectedServiceId`. */
  selectedStackId?: string | null;
  /** Optional per-section "running / total" override. Avoids
   *  recomputing from `statuses` when fixtures already carry it. */
  sectionCounts?: Record<string, { running: number; total: number }>;
  /** Workspace-level summary counts shown next to the WORKSPACE
   *  header. Match the desktop chrome's "3 on / 3 dirty" pills. */
  workspaceTotals?: {
    total: number;
    running: number;
    dirty: number;
  };
  onSelectService?: (id: ServiceId) => void;
  onSelectStack?: (id: string) => void;
  className?: string;
}

const SECTION_DOT: Record<NonNullable<SidebarSection['color']>, string> = {
  blue: 'bg-cat-frontend',
  green: 'bg-status-running',
  orange: 'bg-accent',
  purple: 'bg-cat-backend',
  pink: 'bg-cat-tooling',
  cyan: 'bg-cat-frontend',
  yellow: 'bg-status-starting',
  slate: 'bg-fg-dim',
};

interface RowProps {
  service: ServiceDef;
  status: Status;
  sample?: import('@runhq/cockpit-types').ResourceSample;
  runtime?: RuntimeBadgeKey;
  selected?: boolean;
  onSelect?: () => void;
}

function ServiceRow({ service, status, sample, runtime, selected, onSelect }: RowProps) {
  const cpu = sample?.cpu_percent;
  const mem = sample?.memory_bytes;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition',
        selected
          ? 'bg-accent/12 text-accent'
          : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
      )}
    >
      <StatusDot status={status} size="xs" />
      <span className="text-fg truncate font-medium">{service.name}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {runtime && <RuntimeBadge runtime={runtime} />}
        {sample ? (
          <>
            <span className={cn('font-mono text-[10.5px] tabular-nums', cpuToneClass(cpu ?? 0))}>
              {formatPercent(cpu!)}
            </span>
            <span className={cn('font-mono text-[10.5px] tabular-nums', memoryToneClass(mem ?? 0))}>
              {formatBytes(mem!)}
            </span>
          </>
        ) : null}
      </div>
    </button>
  );
}

interface SectionBlockProps {
  section: SidebarSection;
  services: Record<ServiceId, ServiceDef>;
  statuses: Record<ServiceId, Status>;
  samples?: Props['samples'];
  runtimes?: Props['runtimes'];
  count: { running: number; total: number };
  selectedServiceId?: ServiceId | null;
  onSelectService?: (id: ServiceId) => void;
}

function SectionBlock({
  section,
  services,
  statuses,
  samples,
  runtimes,
  count,
  selectedServiceId,
  onSelectService,
}: SectionBlockProps) {
  const [open, setOpen] = useState(true);
  const dotClass = SECTION_DOT[section.color ?? 'slate'];
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-fg-muted hover:text-fg group flex items-center gap-1.5 px-1.5 py-1.5 text-[11.5px] font-semibold tracking-[0.04em] uppercase"
      >
        {open ? (
          <ChevronDown className="text-fg-dim h-3 w-3" />
        ) : (
          <ChevronRight className="text-fg-dim h-3 w-3" />
        )}
        <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} aria-hidden />
        <span className="text-fg">{section.name}</span>
        {count.total > 0 && (
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 font-mono text-[9.5px] tracking-normal normal-case',
              count.running > 0
                ? 'bg-status-running/12 text-status-running'
                : 'bg-surface-muted text-fg-dim',
            )}
          >
            {count.total === count.running || count.running === 0
              ? count.total
              : `${count.running}/${count.total}`}
          </span>
        )}
      </button>
      {open && (
        <ul className="flex flex-col gap-0.5 pl-1.5">
          {section.serviceIds.map((id) => {
            const svc = services[id];
            if (!svc) return null;
            return (
              <li key={id}>
                <ServiceRow
                  service={svc}
                  status={statuses[id] ?? 'stopped'}
                  sample={samples?.[id]}
                  runtime={runtimes?.[id]}
                  selected={selectedServiceId === id}
                  onSelect={() => onSelectService?.(id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Marketing-grade workspace sidebar.
 *
 * Visually mirrors apps/desktop's `SidebarRail` — section folders with
 * collapsible bodies, per-service runtime badges, CPU + RAM read-out
 * on the right edge, header pills for workspace totals — but with
 * the live machinery (Zustand store, drag-and-drop, search) stripped
 * out. When the desktop sidebar is refactored to a prop-driven shape
 * this component will absorb its remaining behaviour; for now the
 * two are kept in visual lockstep by hand.
 */
export function WorkspaceSidebar({
  services,
  sections,
  stacks = [],
  statuses,
  samples,
  runtimes,
  selectedServiceId,
  selectedStackId,
  sectionCounts,
  workspaceTotals,
  onSelectService,
  onSelectStack,
  className,
}: Props) {
  const serviceMap = Object.fromEntries(services.map((s) => [s.id, s])) as Record<
    ServiceId,
    ServiceDef
  >;

  // Flat fallback when the caller doesn't pass sections — keeps the
  // loop section's simpler use-case working without a synthetic
  // section blob.
  const flat = sections === undefined;

  // Derive section running counts from the status map when the
  // caller doesn't supply pre-computed values. Cheap; runs once per
  // render and N is small (≤ 10 in practice).
  const counts = (id: string | null) => {
    const override = sectionCounts?.[id ?? '__unassigned'];
    if (override) return override;
    const ids = sections?.find((s) => s.id === id)?.serviceIds ?? [];
    const running = ids.filter((sid) => statuses[sid] === 'running').length;
    return { running, total: ids.length };
  };

  return (
    <aside
      className={cn(
        'border-border bg-surface flex h-full w-[260px] shrink-0 flex-col border-r',
        className,
      )}
    >
      <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
        <span className="text-fg-dim text-[11px] font-semibold tracking-[0.08em] uppercase">
          Workspace
        </span>
        {workspaceTotals && (
          <>
            <span className="text-fg text-[12px] font-semibold tabular-nums">
              {workspaceTotals.total}
            </span>
            <span className="bg-status-running/15 text-status-running rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold">
              {workspaceTotals.running} on
            </span>
            {workspaceTotals.dirty > 0 && (
              <span className="bg-status-starting/15 text-status-starting rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold">
                {workspaceTotals.dirty} dirty
              </span>
            )}
          </>
        )}
        <button
          type="button"
          className="text-fg-dim hover:text-fg ml-auto"
          aria-label="Filter sidebar"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="scrollbar-thin flex flex-1 flex-col gap-3 overflow-y-auto px-2 py-2">
        {stacks.length > 0 && (
          <div>
            <div className="text-fg-dim px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase">
              Stacks
            </div>
            <ul className="flex flex-col gap-0.5">
              {stacks.map(({ stack, running, total }) => {
                const isSelected = selectedStackId === stack.id;
                return (
                  <li key={stack.id}>
                    <button
                      type="button"
                      onClick={() => onSelectStack?.(stack.id)}
                      className={cn(
                        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition',
                        isSelected
                          ? 'bg-accent/12 text-accent'
                          : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
                      )}
                    >
                      <Layers
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          isSelected ? 'text-accent' : 'text-fg-dim',
                        )}
                      />
                      <span className="truncate font-medium">{stack.name}</span>
                      <span className="text-fg-dim ml-auto text-[10.5px] tabular-nums">
                        {running}/{total}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {flat ? (
          <ul className="flex flex-col gap-0.5">
            {services.map((svc) => (
              <li key={svc.id}>
                <ServiceRow
                  service={svc}
                  status={statuses[svc.id] ?? 'stopped'}
                  sample={samples?.[svc.id]}
                  runtime={runtimes?.[svc.id]}
                  selected={selectedServiceId === svc.id}
                  onSelect={() => onSelectService?.(svc.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-2">
            {sections!.map((section) => (
              <SectionBlock
                key={section.id ?? '__unassigned'}
                section={section}
                services={serviceMap}
                statuses={statuses}
                samples={samples}
                runtimes={runtimes}
                count={counts(section.id)}
                selectedServiceId={selectedServiceId}
                onSelectService={onSelectService}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-border bg-surface text-fg-muted mt-auto flex shrink-0 items-center justify-between border-t px-2 py-2 text-[11px]">
        <button
          type="button"
          className="hover:text-fg flex items-center gap-1 px-1.5 py-1 transition"
        >
          <Plus className="h-3 w-3" />
          Service
        </button>
        <button
          type="button"
          className="hover:text-fg flex items-center gap-1 px-1.5 py-1 transition"
        >
          <Plus className="h-3 w-3" />
          Stack
        </button>
        <button
          type="button"
          className="hover:text-fg flex items-center gap-1 px-1.5 py-1 transition"
        >
          <Plus className="h-3 w-3" />
          Section
        </button>
      </div>
    </aside>
  );
}
