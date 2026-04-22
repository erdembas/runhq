import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CircleSlash,
  FolderSearch,
  GitBranch,
  Layers,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { useAppStore, type DashboardGroupBy } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { categoryForTags, CATEGORIES } from '@/lib/categories';
import { runtimeFromTags, inferRuntimeFromCmds, runtimeMeta, RUNTIMES } from '@/lib/runtimes';
import { sectionColor } from '@/lib/sectionColors';
import { modChord } from '@/lib/platform';
import type { SectionId, ServiceDef, Status } from '@/types';
import type { GitStatus } from '@/types';
import { ServiceCard } from './ServiceCard';
import { StatTile } from './StatTile';
import { SectionHeader, HeaderAction } from './SectionHeader';

interface Props {
  onScan: () => void;
}

type DashGroup = {
  key: string;
  label: string;
  dotClass?: string;
  labelClass?: string;
  dotStyle?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
  services: ServiceDef[];
};

const GROUP_OPTIONS: Array<{ key: DashboardGroupBy; label: string }> = [
  { key: 'none', label: 'None' },
  { key: 'category', label: 'Category' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'status', label: 'Status' },
];

const UNASSIGNED: SectionId = '__unassigned__';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard({ onScan }: Props) {
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);
  const ports = useAppStore((s) => s.ports);
  const appVersion = useAppStore((s) => s.appVersion);
  const openEditor = useAppStore((s) => s.openEditor);
  const stacks = useAppStore((s) => s.stacks);
  const removeStack = useAppStore((s) => s.removeStack);
  const openStackEditor = useAppStore((s) => s.openStackEditor);
  const setSelectedStack = useAppStore((s) => s.setSelectedStack);
  const upsertStack = useAppStore((s) => s.upsertStack);
  const git = useAppStore((s) => s.git);
  const groupBy = useAppStore((s) => s.dashboardGroupBy);
  const setGroupBy = useAppStore((s) => s.setDashboardGroupBy);
  const sections = useAppStore((s) => s.sections);
  const serviceSection = useAppStore((s) => s.serviceSection);

  type GitFilter = 'all' | 'dirty' | 'clean' | 'ahead' | 'behind' | 'no-upstream';
  const [gitFilter, setGitFilter] = useState<GitFilter>('all');

  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const stats = useMemo(() => {
    let running = 0,
      starting = 0,
      stopped = 0,
      failed = 0;
    for (const svc of services) {
      const st: Status = statuses[svc.id]?.status ?? 'stopped';
      if (st === 'running') running++;
      else if (st === 'starting' || st === 'stopping') starting++;
      else if (st === 'crashed' || st === 'exited') failed++;
      else stopped++;
    }
    return { running, starting, stopped, failed };
  }, [services, statuses]);

  const total = services.length;

  const gitStats = useMemo(() => {
    let dirty = 0,
      clean = 0,
      ahead = 0,
      behind = 0,
      noUpstream = 0;
    for (const svc of services) {
      const g = git[svc.id];
      if (g === null || g === undefined) continue;
      if (g.is_dirty) dirty++;
      else clean++;
      if (g.ahead > 0) ahead++;
      if (g.behind > 0) behind++;
      if (!g.upstream) noUpstream++;
    }
    return { dirty, clean, ahead, behind, noUpstream };
  }, [services, git]);

  const gitFilterFn = useMemo(() => {
    if (gitFilter === 'all') return (_svc: ServiceDef, _g: GitStatus | null | undefined) => true;
    const fn: Record<string, (_svc: ServiceDef, g: GitStatus | null | undefined) => boolean> = {
      dirty: (_s, g) => g !== null && g !== undefined && g.is_dirty,
      clean: (_s, g) => g !== null && g !== undefined && !g.is_dirty,
      ahead: (_s, g) => g !== null && g !== undefined && g.ahead > 0,
      behind: (_s, g) => g !== null && g !== undefined && g.behind > 0,
      'no-upstream': (_s, g) => g !== null && g !== undefined && !g.upstream,
    };
    return fn[gitFilter] ?? (() => true);
  }, [gitFilter]);

  const eligibleServices = useMemo(() => {
    const stackServiceIds = new Set(stacks.flatMap((st) => st.service_ids));
    return services.filter((svc) => !stackServiceIds.has(svc.id) && gitFilterFn(svc, git[svc.id]));
  }, [services, stacks, gitFilterFn, git]);

  const groups = useMemo<DashGroup[]>(() => {
    if (groupBy === 'none') {
      if (sections.length === 0) return [];
      const bySection = new Map<SectionId, ServiceDef[]>();
      const validIds = new Set(sections.map((s) => s.id));
      for (const svc of eligibleServices) {
        const assigned = serviceSection[svc.id];
        const key = assigned && validIds.has(assigned) ? assigned : UNASSIGNED;
        const bucket = bySection.get(key);
        if (bucket) bucket.push(svc);
        else bySection.set(key, [svc]);
      }
      for (const list of bySection.values()) list.sort((a, b) => a.name.localeCompare(b.name));
      const result: DashGroup[] = [];
      for (const sec of sections) {
        const svcs = bySection.get(sec.id);
        if (svcs && svcs.length > 0) {
          const meta = sectionColor(sec.color);
          result.push({
            key: sec.id,
            label: sec.name,
            dotStyle: { backgroundColor: meta.solid },
            labelStyle: { color: meta.solid },
            services: svcs,
          });
        }
      }
      const unassigned = bySection.get(UNASSIGNED);
      if (unassigned && unassigned.length > 0) {
        result.push({ key: UNASSIGNED, label: 'Unassigned', services: unassigned });
      }
      return result;
    }

    if (groupBy === 'status') {
      const running: ServiceDef[] = [];
      const stopped: ServiceDef[] = [];
      for (const svc of eligibleServices) {
        const st: Status = statuses[svc.id]?.status ?? 'stopped';
        if (st === 'running' || st === 'starting') running.push(svc);
        else stopped.push(svc);
      }
      running.sort((a, b) => a.name.localeCompare(b.name));
      stopped.sort((a, b) => a.name.localeCompare(b.name));
      const out: DashGroup[] = [];
      if (running.length > 0)
        out.push({
          key: 'running',
          label: 'Running',
          dotClass: 'bg-status-running',
          labelClass: 'text-status-running',
          services: running,
        });
      if (stopped.length > 0)
        out.push({
          key: 'stopped',
          label: 'Stopped',
          dotClass: 'bg-fg-dim/50',
          labelClass: 'text-fg-dim',
          services: stopped,
        });
      return out;
    }

    if (groupBy === 'runtime') {
      const byKey = new Map<string, DashGroup>();
      for (const svc of eligibleServices) {
        const rt = runtimeFromTags(svc.tags) ?? inferRuntimeFromCmds(svc.cmds) ?? 'other';
        const meta = runtimeMeta(rt);
        let group = byKey.get(rt);
        if (!group) {
          group = { key: rt, label: meta.label, labelClass: meta.color, services: [] };
          byKey.set(rt, group);
        }
        group.services.push(svc);
      }
      for (const g of byKey.values()) g.services.sort((a, b) => a.name.localeCompare(b.name));
      const order = new Map<string, number>();
      RUNTIMES.forEach((r, i) => order.set(r.key, i));
      return [...byKey.values()].sort(
        (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999),
      );
    }

    const byKey = new Map<string, DashGroup>();
    for (const svc of eligibleServices) {
      const c = categoryForTags(svc.tags);
      let group = byKey.get(c.key);
      if (!group) {
        group = { key: c.key, label: c.label, dotClass: c.dot, labelClass: c.color, services: [] };
        byKey.set(c.key, group);
      }
      group.services.push(svc);
    }
    for (const g of byKey.values()) g.services.sort((a, b) => a.name.localeCompare(b.name));
    const order = new Map<string, number>();
    CATEGORIES.forEach((c, i) => order.set(c.key, i));
    return [...byKey.values()].sort(
      (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999),
    );
  }, [eligibleServices, groupBy, statuses, sections, serviceSection]);

  if (total === 0) {
    return (
      <div className="bg-surface relative flex flex-1 items-center justify-center overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(600px 400px at 50% 30%, rgb(var(--accent) / 0.06), transparent 70%)',
          }}
        />
        <div className="glass animate-fade-in relative max-w-sm p-8 text-center">
          <div className="bg-accent/10 border-accent/30 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border">
            <Zap className="text-accent h-7 w-7" />
          </div>
          <h2 className="text-fg text-xl font-semibold tracking-tight">Ready when you are</h2>
          <p className="text-fg-muted mt-2 text-[13px] leading-relaxed">
            Point RunHQ at a project folder to auto-detect scripts, or add your first service
            manually.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<FolderSearch className="h-4 w-4" />}
              onClick={onScan}
            >
              Scan Projects
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => openEditor(null)}
            >
              Add service{' '}
              <Kbd className="ml-1.5 border-transparent bg-white/20 text-white/90">
                {modChord('N')}
              </Kbd>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const healthPct = total > 0 ? Math.round((stats.running / total) * 100) : 0;
  const hasRunning = stats.running > 0;

  return (
    <div className="bg-surface relative flex flex-1 flex-col overflow-y-auto">
      {hasRunning && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[340px]"
          style={{
            background:
              'radial-gradient(900px 340px at 50% -20%, rgb(var(--accent) / 0.09), transparent 70%)',
          }}
        />
      )}

      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-8 py-8">
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-fg-dim mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase">
              <span className="from-accent to-accent-hover border-accent/40 inline-flex h-5 w-5 items-center justify-center rounded-md border bg-gradient-to-br text-white shadow-[0_2px_8px_-2px_rgb(var(--accent)/0.6)]">
                <Zap className="h-3 w-3" />
              </span>
              <span className="text-fg">RunHQ</span>
              {appVersion && (
                <span className="text-fg-dim normal-case opacity-70">v{appVersion}</span>
              )}
              <span className="text-fg-dim mx-1 opacity-30">·</span>
              <span className="text-fg-dim tracking-normal normal-case opacity-70">
                {greeting()}
              </span>
            </div>
            <h1 className="text-fg text-[28px] leading-tight font-semibold tracking-tight">
              {hasRunning ? (
                <>
                  <span className="text-status-running tabular-nums">{stats.running}</span>
                  <span className="text-fg"> service{stats.running > 1 ? 's' : ''} running</span>
                </>
              ) : stats.failed > 0 ? (
                <>
                  <span className="text-status-error tabular-nums">{stats.failed}</span>
                  <span className="text-fg"> needs attention</span>
                </>
              ) : (
                <span className="text-fg">All quiet</span>
              )}
            </h1>
            <p className="text-fg-muted mt-1.5 flex items-center gap-1.5 text-[13px]">
              <span className="tabular-nums">{total}</span> configured
              <span className="text-fg-dim">·</span>
              <span className="tabular-nums">{ports.length}</span> listening ports
              {stats.starting > 0 && (
                <>
                  <span className="text-fg-dim">·</span>
                  <span className="text-status-starting inline-flex items-center gap-1 tabular-nums">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {stats.starting} starting
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="border-border flex items-center gap-1 rounded-md border px-1 py-0.5">
              {GROUP_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setGroupBy(opt.key)}
                  className={cn(
                    'rounded-sm px-1.5 py-0.5 text-[10px] font-semibold transition',
                    groupBy === opt.key
                      ? 'bg-accent/15 text-accent'
                      : 'text-fg-dim hover:text-fg hover:bg-surface-muted/60',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<FolderSearch className="h-4 w-4" />}
              onClick={onScan}
            >
              Scan Projects
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Layers className="h-4 w-4" />}
              onClick={() => openStackEditor(null)}
            >
              New stack
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => openEditor(null)}
            >
              New service
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            label="Running"
            value={stats.running}
            tone="running"
            icon={<Activity className="h-3.5 w-3.5" />}
            badge={`${healthPct}%`}
            active={stats.running > 0}
          />
          <StatTile
            label="Starting"
            value={stats.starting}
            tone="starting"
            icon={<Loader2 className={cn('h-3.5 w-3.5', stats.starting > 0 && 'animate-spin')} />}
            active={stats.starting > 0}
          />
          <StatTile
            label="Stopped"
            value={stats.stopped}
            tone="stopped"
            icon={<CircleSlash className="h-3.5 w-3.5" />}
          />
          <StatTile
            label="Failed"
            value={stats.failed}
            tone={stats.failed > 0 ? 'error' : 'stopped'}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            active={stats.failed > 0}
          />
        </section>

        {total > 0 && (
          <div className="glass flex items-center gap-3 px-4 py-2.5">
            <span className="text-fg-dim text-[11px] font-semibold tracking-[0.12em] uppercase">
              Uptime
            </span>
            <div className="bg-surface-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-700',
                  hasRunning
                    ? 'from-accent via-accent to-status-running bg-gradient-to-r'
                    : 'bg-border-strong',
                )}
                style={{ width: `${Math.max(healthPct, hasRunning ? 4 : 0)}%` }}
              />
            </div>
            <span className="text-fg w-10 text-right text-[12px] font-semibold tabular-nums">
              {healthPct}%
            </span>
          </div>
        )}

        {gitStats.dirty + gitStats.clean > 0 && (
          <div className="glass flex items-center gap-2 px-4 py-2">
            <GitBranch className="text-fg-dim h-3.5 w-3.5" />
            <span className="text-fg-dim text-[11px] font-semibold tracking-[0.12em] uppercase">
              Git
            </span>
            <div className="flex items-center gap-1">
              <FilterPill
                active={gitFilter === 'all'}
                onClick={() => setGitFilter('all')}
                label="All"
                count={gitStats.dirty + gitStats.clean}
              />
              <FilterPill
                active={gitFilter === 'dirty'}
                onClick={() => setGitFilter('dirty')}
                label="Dirty"
                count={gitStats.dirty}
                tone="dirty"
              />
              <FilterPill
                active={gitFilter === 'clean'}
                onClick={() => setGitFilter('clean')}
                label="Clean"
                count={gitStats.clean}
                tone="clean"
              />
              <FilterPill
                active={gitFilter === 'ahead'}
                onClick={() => setGitFilter('ahead')}
                label="Ahead"
                count={gitStats.ahead}
              />
              <FilterPill
                active={gitFilter === 'behind'}
                onClick={() => setGitFilter('behind')}
                label="Behind"
                count={gitStats.behind}
              />
              <FilterPill
                active={gitFilter === 'no-upstream'}
                onClick={() => setGitFilter('no-upstream')}
                label="No upstream"
                count={gitStats.noUpstream}
              />
            </div>
          </div>
        )}

        {stacks.map((stack) => {
          const stackServices = stack.service_ids
            .map((sid) => services.find((s) => s.id === sid))
            .filter((svc): svc is ServiceDef => !!svc && gitFilterFn(svc, git[svc.id]));
          const runningCount = stackServices.filter(
            (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'running',
          ).length;
          const anyRunning = runningCount > 0;
          return (
            <section
              key={stack.id}
              className="group/section"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={async (e) => {
                e.preventDefault();
                const svcId = e.dataTransfer.getData('application/x-service-id');
                if (!svcId || stack.service_ids.includes(svcId)) return;
                const updated = { ...stack, service_ids: [...stack.service_ids, svcId] };
                await ipc.updateStack(updated);
                upsertStack(updated);
              }}
            >
              <SectionHeader
                icon={<Layers className="h-3.5 w-3.5" />}
                label={stack.name}
                tone="accent"
                count={stackServices.length}
                runningCount={runningCount}
                onClick={() => setSelectedStack(stack.id)}
                actions={
                  <>
                    {anyRunning ? (
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
                    <HeaderAction
                      title="Restart all"
                      onClick={() => void ipc.restartStack(stack.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </HeaderAction>
                    <HeaderAction title="Edit stack" onClick={() => openStackEditor(stack)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </HeaderAction>
                    <HeaderAction
                      title="Delete stack"
                      tone="danger"
                      onClick={() => {
                        setPendingConfirm({
                          message: `Delete stack "${stack.name}"?`,
                          onConfirm: async () => {
                            setPendingConfirm(null);
                            await ipc.removeStack(stack.id);
                            removeStack(stack.id);
                          },
                        });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </HeaderAction>
                  </>
                }
              />
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {stackServices.map((svc) => (
                  <ServiceCard key={svc.id} svc={svc} />
                ))}
              </div>
            </section>
          );
        })}

        {groups.length > 0
          ? groups.map((group) => {
              const runningInGroup = group.services.filter(
                (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'running',
              ).length;
              return (
                <section key={group.key} className="group/section">
                  <SectionHeader
                    dotClass={group.dotClass}
                    dotStyle={group.dotStyle}
                    label={group.label}
                    labelClass={group.labelClass}
                    labelStyle={group.labelStyle}
                    count={group.services.length}
                    runningCount={runningInGroup}
                  />
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {group.services.map((svc) => (
                      <ServiceCard key={svc.id} svc={svc} draggable />
                    ))}
                  </div>
                </section>
              );
            })
          : eligibleServices.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {eligibleServices.map((svc) => (
                  <ServiceCard key={svc.id} svc={svc} draggable />
                ))}
              </div>
            )}

        <footer className="text-fg-dim mt-auto flex items-center justify-between pt-4 text-[11px]">
          <span>Everything runs locally. No telemetry.</span>
          <span className="flex items-center gap-1.5 opacity-70">
            <Kbd>{modChord('K')}</Kbd>
            <span>quick jump</span>
          </span>
        </footer>
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

function FilterPill({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: 'dirty' | 'clean';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-app-sm inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold transition',
        active
          ? tone === 'dirty'
            ? 'bg-status-starting/20 text-status-starting'
            : tone === 'clean'
              ? 'bg-status-running/20 text-status-running'
              : 'bg-accent/15 text-accent'
          : 'text-fg-dim hover:text-fg hover:bg-surface-muted/60',
      )}
    >
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
