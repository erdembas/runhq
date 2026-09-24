import * as i18n from '@runhq/cockpit-ui/i18n';
import { lazy, Suspense, useEffect, useRef } from 'react';
import {
  BookOpen,
  Bot,
  FileText,
  GitBranch,
  LayoutDashboard,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useWorkbenchStore, type ProjectSection } from '@/store/useWorkbenchStore';
import { openProjectSection } from '@/lib/workbenchNavigation';
import { registerServiceShortcuts } from '@/lib/serviceShortcutBus';
import { cn } from '@/lib/cn';
import { ProjectOverview } from './ProjectOverview';

const LogPanel = lazy(() => import('@/components/LogPanel').then((m) => ({ default: m.LogPanel })));
const DiffViewer = lazy(() =>
  import('@/components/DiffViewer').then((m) => ({ default: m.DiffViewer })),
);
const ProjectHealth = lazy(() =>
  import('./ProjectHealth').then((m) => ({ default: m.ProjectHealth })),
);
const ProjectAgentsTab = lazy(() =>
  import('@/components/agents/ProjectAgentsTab').then((m) => ({ default: m.ProjectAgentsTab })),
);
const runtimeSections = new Set<ProjectSection>(['run', 'docs', 'notes']);

export function ProjectWorkbench({
  serviceId,
  isActive,
}: {
  serviceId: string;
  isActive: boolean;
}) {
  i18n.useLocale();
  const service = useAppStore((s) => s.services.find((entry) => entry.id === serviceId));
  const section = useWorkbenchStore((s) => s.projectSections[serviceId] ?? 'overview');
  const pendingBodyTab = useAppStore((s) => s.pendingServiceBodyTab[serviceId]);
  const visited = useRef(new Set<ProjectSection>());
  visited.current.add(section);
  const hasRuntime = [...visited.current].some((value) => runtimeSections.has(value));
  const lastRuntimeSection = useRef<'run' | 'docs' | 'notes'>('run');
  if (section === 'run' || section === 'docs' || section === 'notes')
    lastRuntimeSection.current = section;

  useEffect(() => {
    if (hasRuntime) return;
    return registerServiceShortcuts(serviceId, {
      newTerminal: () => useAppStore.getState().openServiceWithBodyTab(serviceId, 'terminal'),
    });
  }, [serviceId, hasRuntime]);

  // Deep links can arrive before the runtime host has ever been visited.
  useEffect(() => {
    if (!isActive || !pendingBodyTab || hasRuntime) return;
    if (pendingBodyTab === 'agents') {
      useAppStore.getState().consumePendingServiceBodyTab(serviceId);
      openProjectSection(serviceId, 'agents');
    } else {
      openProjectSection(
        serviceId,
        pendingBodyTab === 'docs' || pendingBodyTab === 'notes' ? pendingBodyTab : 'run',
      );
    }
  }, [isActive, pendingBodyTab, hasRuntime, serviceId]);

  if (!service) return <p className="text-fg-muted p-5">{i18n.t('Loading service…')}</p>;
  const sections = [
    { id: 'overview' as const, label: i18n.t('Overview'), icon: LayoutDashboard },
    { id: 'agents' as const, label: i18n.t('Agents'), icon: Bot },
    { id: 'run' as const, label: i18n.t('Run'), icon: Play },
    { id: 'git' as const, label: i18n.t('Git'), icon: GitBranch },
    { id: 'docs' as const, label: i18n.t('Docs'), icon: BookOpen },
    { id: 'notes' as const, label: i18n.t('Notes'), icon: FileText },
    { id: 'health' as const, label: i18n.t('Health'), icon: ShieldCheck },
  ];
  const runtimeVisible = isActive && runtimeSections.has(section);
  return (
    <div
      className="bg-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={i18n.t('Project workspace')}
    >
      <nav
        aria-label={i18n.t('Project sections')}
        className="border-border/70 bg-surface-raised/30 flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b px-3"
      >
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => openProjectSection(serviceId, id)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[12px] transition',
              section === id
                ? 'bg-fg/7 text-fg font-medium'
                : 'text-fg-dim hover:bg-fg/4 hover:text-fg',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <span className="text-fg-dim ml-auto hidden max-w-48 truncate pl-4 text-[11px] lg:block">
          {service.name}
        </span>
      </nav>
      {visited.current.has('overview') && (
        <div
          className={section === 'overview' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          aria-hidden={section !== 'overview'}
        >
          <ProjectOverview service={service} visible={isActive && section === 'overview'} />
        </div>
      )}
      {visited.current.has('agents') && (
        <div
          className={section === 'agents' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          aria-hidden={section !== 'agents'}
        >
          <Suspense fallback={<Loading />}>
            <ProjectAgentsTab
              serviceId={serviceId}
              cwd={service.cwd}
              name={service.name}
              visible={isActive && section === 'agents'}
            />
          </Suspense>
        </div>
      )}
      {hasRuntime && (
        <div
          className={runtimeSections.has(section) ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          aria-hidden={!runtimeSections.has(section)}
        >
          <Suspense fallback={<Loading />}>
            <LogPanel
              serviceId={serviceId}
              isActive={runtimeVisible}
              workbenchSection={lastRuntimeSection.current}
            />
          </Suspense>
        </div>
      )}
      {visited.current.has('git') && (
        <div
          className={section === 'git' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          aria-hidden={section !== 'git'}
        >
          <div className="border-border text-fg-dim flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-[11px]">
            <GitBranch className="h-3 w-3" />
            <span>{i18n.t('Main working copy')}</span>
            <span className="truncate font-mono" title={service.cwd}>
              {service.cwd}
            </span>
          </div>
          <Suspense fallback={<Loading />}>
            <DiffViewer
              serviceId={serviceId}
              embedded
              visible={isActive && section === 'git'}
              onClose={() => openProjectSection(serviceId, 'overview')}
            />
          </Suspense>
        </div>
      )}
      {visited.current.has('health') && (
        <div
          className={section === 'health' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          aria-hidden={section !== 'health'}
        >
          <Suspense fallback={<Loading />}>
            <ProjectHealth service={service} visible={isActive && section === 'health'} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function Loading() {
  i18n.useLocale();
  return <div className="text-fg-muted p-5 text-sm">{i18n.t('Loading…')}</div>;
}
