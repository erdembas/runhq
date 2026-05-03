import type { ReactNode } from 'react';
import { Layers, Pencil, Play, RotateCcw, Search, Square, Trash2 } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import type { ServiceDef, StackDef } from '@/types';
import type { DashGroup } from './model';
import { CardSearchSlot } from './DashboardSearchBar';
import { HeaderAction, SectionHeader } from './SectionHeader';
import { ServiceCard } from './ServiceCard';
import type { DashboardModel } from './useDashboardModel';

interface Props {
  model: DashboardModel;
}

export function DashboardServiceSections({ model }: Props) {
  return (
    <>
      {model.stacks.map((stack) => (
        <StackSection key={stack.id} model={model} stack={stack} />
      ))}
      {model.totalMatchedCount === 0 &&
        (model.effectiveQuery !== '' ||
          model.gitFilter !== 'all' ||
          model.attentionFilter !== 'all') && <NoMatchesEmpty model={model} />}
      {model.groups.length > 0 ? (
        model.groups.map((group) => <GroupSection key={group.key} model={model} group={group} />)
      ) : (
        <FlatServiceGrid model={model} />
      )}
    </>
  );
}

function StackSection({ model, stack }: Props & { stack: StackDef }) {
  const stackServices = stack.service_ids
    .map((sid) => model.services.find((s) => s.id === sid))
    .filter((svc): svc is ServiceDef => !!svc);
  const visibleStackServices = model.visibleServiceIds
    ? stackServices.filter((svc) => model.visibleServiceIds?.has(svc.id))
    : stackServices;
  const runningCount = visibleStackServices.filter(
    (svc) => (model.statuses[svc.id]?.status ?? 'stopped') === 'running',
  ).length;
  const sectionHidden = model.visibleServiceIds !== null && visibleStackServices.length === 0;

  return (
    <section
      className="group/section"
      style={sectionHidden ? { display: 'none' } : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        void model.dropServiceOnStack(stack, e.dataTransfer.getData('application/x-service-id'));
      }}
    >
      <SectionHeader
        icon={<Layers className="h-3.5 w-3.5" />}
        label={stack.name}
        tone="accent"
        count={visibleStackServices.length}
        runningCount={runningCount}
        onClick={() => model.setSelectedStack(stack.id)}
        actions={
          <>
            {runningCount > 0 ? (
              <HeaderAction
                title="Stop all"
                onClick={() => void ipc.stopStack(stack.id)}
                tone="danger"
              >
                <Square className="h-3.5 w-3.5" />
              </HeaderAction>
            ) : (
              <HeaderAction
                title="Start all"
                onClick={() => void ipc.startStack(stack.id)}
                tone="run"
              >
                <Play className="h-3.5 w-3.5" />
              </HeaderAction>
            )}
            <HeaderAction title="Restart all" onClick={() => void ipc.restartStack(stack.id)}>
              <RotateCcw className="h-3.5 w-3.5" />
            </HeaderAction>
            <HeaderAction title="Edit stack" onClick={() => model.openStackEditor(stack)}>
              <Pencil className="h-3.5 w-3.5" />
            </HeaderAction>
            <HeaderAction
              title="Delete stack"
              tone="danger"
              onClick={() => model.requestDeleteStack(stack)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </HeaderAction>
          </>
        }
      />
      <ServiceGrid>
        {stackServices.map((svc) => (
          <ServiceCardSlot key={svc.id} model={model} svc={svc} />
        ))}
      </ServiceGrid>
    </section>
  );
}

function GroupSection({ model, group }: Props & { group: DashGroup }) {
  const visibleGroupServices = model.visibleServiceIds
    ? group.services.filter((svc) => model.visibleServiceIds?.has(svc.id))
    : group.services;
  const runningInGroup = visibleGroupServices.filter(
    (svc) => (model.statuses[svc.id]?.status ?? 'stopped') === 'running',
  ).length;
  const sectionHidden = model.visibleServiceIds !== null && visibleGroupServices.length === 0;

  return (
    <section className="group/section" style={sectionHidden ? { display: 'none' } : undefined}>
      <SectionHeader
        dotClass={group.dotClass}
        dotStyle={group.dotStyle}
        label={group.label}
        labelClass={group.labelClass}
        labelStyle={group.labelStyle}
        count={visibleGroupServices.length}
        runningCount={runningInGroup}
      />
      <ServiceGrid>
        {group.services.map((svc) => (
          <ServiceCardSlot key={svc.id} model={model} svc={svc} draggable />
        ))}
      </ServiceGrid>
    </section>
  );
}

function FlatServiceGrid({ model }: Props) {
  if (model.sortedEligibleServices.length === 0) return null;
  return (
    <ServiceGrid>
      {model.sortedEligibleServices.map((svc) => (
        <ServiceCardSlot key={svc.id} model={model} svc={svc} draggable />
      ))}
    </ServiceGrid>
  );
}

function ServiceCardSlot({
  model,
  svc,
  draggable,
}: Props & { svc: ServiceDef; draggable?: boolean }) {
  const hidden = model.visibleServiceIds !== null && !model.visibleServiceIds.has(svc.id);
  return (
    <CardSearchSlot hidden={hidden}>
      <ServiceCard
        svc={svc}
        draggable={draggable}
        projectMeta={model.projectMetaById.get(svc.id) ?? null}
        onOpenDetail={model.openDetail}
        onOpenOverlay={model.openServiceOverlay}
      />
    </CardSearchSlot>
  );
}

function ServiceGrid({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
      {children}
    </div>
  );
}

function NoMatchesEmpty({ model }: Props) {
  return (
    <div className="border-border/60 bg-surface-raised/40 rounded-app flex flex-col items-center gap-2 border border-dashed px-6 py-10 text-center">
      <Search className="text-fg-dim/70 h-5 w-5" />
      <p className="text-fg text-[13px] font-medium">
        {model.effectiveQuery !== '' ? (
          <>
            No matches for <span className="text-accent font-mono">"{model.effectiveQuery}"</span>
          </>
        ) : (
          'No projects match the current filters'
        )}
      </p>
      <p className="text-fg-dim text-[11.5px]">
        {model.effectiveQuery !== ''
          ? 'Search covers names, tags, ports, commands, and paths.'
          : 'Try clearing one or more filters above.'}
      </p>
      <button
        type="button"
        onClick={model.clearFilters}
        className="text-accent hover:text-accent/80 mt-1 text-[11.5px] font-semibold transition"
      >
        Clear all filters
      </button>
    </div>
  );
}
