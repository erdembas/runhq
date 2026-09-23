import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Clock3, Inbox, Search } from 'lucide-react';
import { AgentRequestCard, AgentProviderLogo, SearchableSelect } from '@runhq/cockpit-ui';
import { ipc } from '@/lib/ipc';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentStore } from '@/store/useAgentStore';
import { agentDecisionWait, collectAgentDecisions } from './agentDecisions';
import { answerPendingAgentRequest } from './agentDecisionActions';
import { AgentNotificationSettings } from './AgentNotificationSettings';
import { useAgentProjectOptions } from './useAgentProjectOptions';

const AGENT_DECISION_KINDS = [
  {
    value: 'all',
    get label() {
      return i18n.t('All request types');
    },
  },
  {
    value: 'approval',
    get label() {
      return i18n.t('Permissions');
    },
  },
  {
    value: 'question',
    get label() {
      return i18n.t('Questions');
    },
  },
  {
    value: 'form',
    get label() {
      return i18n.t('Forms');
    },
  },
];

export function AgentDecisionInbox({
  visible = true,
  projectId,
  onOpenSession,
}: {
  visible?: boolean;
  projectId?: string;
  onOpenSession: (sessionId: string, requestId?: string) => void;
}) {
  i18n.useLocale();
  const sessions = useVisibleStore(useAgentStore, (state) => state.sessions, visible);
  const storedProjects = useVisibleStore(useAgentStore, (state) => state.projects, visible);
  const pendingSince = useVisibleStore(useAgentStore, (state) => state.pendingSince, visible);
  const [selectedProject, setSelectedProject] = useState(projectId ?? '');
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  useEffect(() => setSelectedProject(projectId ?? ''), [projectId]);
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible]);
  const all = useMemo(
    () => collectAgentDecisions(sessions, pendingSince),
    [sessions, pendingSince],
  );
  const storedOptions = useAgentProjectOptions(storedProjects, visible);
  const projectOptions = useMemo(() => {
    const known = new Set(storedOptions.map((option) => option.value));
    const extra = [
      ...new Map(
        all
          .filter(({ session }) => !known.has(session.project_id))
          .map(({ session }): [string, string] => [session.project_id, session.project_name]),
      ).entries(),
    ].map(([value, label]) => ({ value, label }));
    return [
      {
        value: '',
        label: i18n.t('All projects'),
        description: i18n.t('Decisions from every project'),
      },
      ...storedOptions,
      ...extra,
    ];
  }, [all, storedOptions]);
  const decisions = useMemo(
    () =>
      collectAgentDecisions(sessions, pendingSince, {
        projectId: selectedProject,
        kind,
        search,
      }),
    [sessions, pendingSince, selectedProject, kind, search],
  );
  const navigate = (direction: -1 | 1) => {
    if (!decisions.length) return;
    const index = decisions.findIndex((decision) => decision.key === focusedKey);
    const next =
      decisions[
        index < 0
          ? direction > 0
            ? 0
            : decisions.length - 1
          : (index + direction + decisions.length) % decisions.length
      ];
    if (!next) return;
    setFocusedKey(next.key);
    cards.current.get(next.key)?.focus();
    cards.current.get(next.key)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return (
    <section
      aria-label={i18n.t('Agent decision inbox')}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        navigate(event.key === 'ArrowUp' ? -1 : 1);
      }}
    >
      <div className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Inbox className="text-accent h-4 w-4" />
        <h2 className="text-fg text-[13px] font-semibold">{i18n.t('Decisions')}</h2>
        <span aria-live="polite" className="text-fg-dim text-[11px]">
          {i18n.rich('{value1} waiting', { value1: decisions.length })}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            aria-label={i18n.t('Previous request (Alt+Up)')}
            title={i18n.t('Previous request (Alt+↑)')}
            disabled={!decisions.length}
            onClick={() => navigate(-1)}
            className="text-fg-dim hover:text-fg rounded p-1.5 disabled:opacity-40"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={i18n.t('Next request (Alt+Down)')}
            title={i18n.t('Next request (Alt+↓)')}
            disabled={!decisions.length}
            onClick={() => navigate(1)}
            className="text-fg-dim hover:text-fg rounded p-1.5 disabled:opacity-40"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex w-full flex-wrap gap-2">
          <SearchableSelect
            label={i18n.t('Decision project')}
            indentGrouped
            value={selectedProject}
            options={projectOptions}
            onChange={setSelectedProject}
            searchPlaceholder={i18n.t('Find a project or group…')}
            className="w-52 max-w-full"
          />
          <SearchableSelect
            label={i18n.t('Decision type')}
            searchable={false}
            value={kind}
            options={AGENT_DECISION_KINDS}
            onChange={setKind}
            className="w-44 max-w-full"
            menuWidth={220}
          />
          <label className="border-border text-fg-dim flex min-w-40 flex-1 items-center gap-2 rounded-lg border px-2">
            <Search className="h-3.5 w-3.5" />
            <input
              aria-label={i18n.t('Search decisions')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={i18n.t('Search tasks or requests…')}
              className="text-fg min-w-0 flex-1 bg-transparent py-1.5 text-[12px] outline-none"
            />
          </label>
        </div>
      </div>
      <AgentNotificationSettings
        projectId={selectedProject || undefined}
        projectName={
          selectedProject
            ? projectOptions.find((option) => option.value === selectedProject)?.label
            : undefined
        }
      />
      <div className="overlay-scroll min-h-0 flex-1 space-y-5 overflow-auto p-4">
        {!decisions.length && (
          <div className="text-fg-dim py-12 text-center text-[13px]">
            {all.length
              ? i18n.t('No waiting requests match these filters.')
              : i18n.t(
                  'No decisions waiting. Questions and permissions from every task appear here.',
                )}
          </div>
        )}
        {decisions.map(({ key, session, request, since }) => (
          <article
            key={key}
            tabIndex={-1}
            ref={(node) => {
              if (node) cards.current.set(key, node);
              else cards.current.delete(key);
            }}
            onFocus={() => setFocusedKey(key)}
            aria-label={`${session.title}: ${request.title}`}
            className="focus-visible:ring-accent/40 mx-auto max-w-3xl rounded-xl outline-none focus-visible:ring-2"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[11px]">
              <AgentProviderLogo backend={session.backend} className="h-3.5 w-3.5" />
              <span className="text-fg font-medium">{session.title}</span>
              <span className="text-fg-dim">{session.project_name}</span>
              <span
                className="text-fg-dim ml-auto inline-flex items-center gap-1"
                title={i18n.t('Waiting since {value1}', {
                  value1: new Date(since).toLocaleString(i18n.getFormatLocale()),
                })}
              >
                <Clock3 className="h-3 w-3" />
                {agentDecisionWait(since, now)}
              </span>
              <button
                type="button"
                onClick={() => onOpenSession(session.id, request.id)}
                className="text-accent inline-flex items-center gap-1 rounded px-1.5 py-1 hover:underline"
              >
                {i18n.rich('Open task{value1}', { value1: <ArrowUpRight className="h-3 w-3" /> })}
              </button>
            </div>
            <AgentRequestCard
              request={request}
              disabled={session.status === 'cancelling'}
              onOpenUrl={(url) => ipc.openUrl(url)}
              onAnswer={(value) => answerPendingAgentRequest(session.id, request.id, value)}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
