import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileDiff,
  GitBranch,
  Loader2,
  ListChecks,
  ListPlus,
  PanelsTopLeft,
  CircleAlert,
  MessageSquare,
  Pencil,
  RefreshCw,
  Square,
  SlidersHorizontal,
  ArrowRightLeft,
  TerminalSquare,
} from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AgentComposer,
  AgentProviderLogo,
  AgentRequestCard,
  AgentStatusBadge,
  agentIsActive,
  AgentProviderPicker,
  AgentModelControls,
  agentProviderNames,
  AgentMessageQueue,
  buildAgentPlanPrompt,
  collectAgentPlans,
  extractAgentCanvasArtifacts,
} from '@runhq/cockpit-ui';
import type { AgentItem, AgentSession } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { describeRoutingNote, parseRoutingNote } from './agentAccountRouting';
import { useAgentStore } from '@/store/useAgentStore';
import { EditorDropdown } from '@/components/EditorDropdown';
import { TerminalPane } from '@/components/TerminalPane';
import { ROOMY_MARKDOWN_COMPONENTS } from '@/components/ai/markdownComponents';
import { useAgentSnapshot } from './useAgentSnapshot';
import { useAgentCatalog } from './useAgentCatalog';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { usePersistentBoolean } from '@/lib/usePersistentBoolean';
import { AgentPlanPanel } from './AgentPlanPanel';
import { AgentCanvasPanel } from './AgentCanvasPanel';
import { agentTurnQueue, useAgentQueueStore } from '@/store/useAgentQueueStore';
import { parseAgentSubagent, agentSubagentSummary } from './agentSubagentItem';
import { groupAgentTranscript } from './agentActivity';
import { AgentActivityBlock } from './AgentActivityBlock';
import { AgentContextTray } from './AgentContextTray';
import { useAgentContext } from './useAgentContext';
import { agentContextImages, buildAgentContextPrompt } from './agentLibraryModel';
import { AgentUsageCard } from './AgentUsageCard';
import { answerPendingAgentRequest } from './agentDecisionActions';
import { startAgentTurnRecoverably, recoverableAgentSender } from './agentSendRecovery';
import {
  agentCanSteer,
  agentComposerContent,
  agentSessionIsHistoryOnly,
} from './agentComposerPolicy';
import { AgentTaskLinks } from './AgentTaskLinks';
import { AgentUsageGuardNotice } from './AgentUsageNotifications';
import { AgentSessionProject } from './AgentSessionProject';
import { AgentUserMessage } from './AgentUserMessage';
import { AgentMessageNavigator } from './AgentMessageNavigator';

const emptyQueue: never[] = [];
const emptyItems: AgentItem[] = [];

const quietButton =
  'text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-accent/50 aria-pressed:bg-fg/7 aria-pressed:text-fg flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] whitespace-nowrap outline-none focus-visible:ring-2 disabled:opacity-40';
const TranscriptItem = memo(function TranscriptItem({
  item,
  providerName,
  request,
}: {
  item: AgentItem;
  providerName: string;
  request?: AgentItem;
}) {
  i18n.useLocale();
  if (item.kind === 'assistant')
    return (
      <article className="text-fg min-w-0 text-[13px] leading-relaxed break-words">
        {item.title && !/^(agentMessage|assistant)$/i.test(item.title.trim()) && (
          <div className="text-fg-dim mb-2 text-[11px]">{item.title}</div>
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={ROOMY_MARKDOWN_COMPONENTS}>
          {item.text}
        </ReactMarkdown>
      </article>
    );
  if (item.kind === 'subagent') {
    const details = parseAgentSubagent(item.text);
    const summary = agentSubagentSummary(details);
    return (
      <article className="border-border/70 ml-3 rounded-md border-l-2 py-1.5 pl-3 text-[12px]">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <GitBranch className="text-fg-dim h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="text-fg-muted">{item.title}</span>
          {summary.length > 0 && <span className="text-fg-dim">{summary.join(' · ')}</span>}
        </div>
        {details.prompt && (
          <p className="text-fg-dim mt-1 break-words whitespace-pre-wrap">{details.prompt}</p>
        )}
        <p className="text-fg-dim mt-1 text-[11px]">
          {i18n.rich('Ran inside {providerName}; RunHQ reports it but does not schedule it.', {
            providerName: providerName,
          })}
        </p>
      </article>
    );
  }
  if (item.kind === 'user') return <AgentUserMessage item={item} request={request} />;
  const title =
    item.kind === 'automatic_approval'
      ? item.status === 'failed'
        ? i18n.t('Automatic approval failed: {request}', { request: item.title })
        : i18n.t('Automatically approved: {request}', { request: item.title })
      : item.title;
  return (
    <details
      className={`group rounded-md text-[12px] ${item.status === 'failed' ? 'border-status-error/20 bg-status-error/5 text-status-error border' : 'text-fg-dim'}`}
      open={item.kind === 'plan' || item.kind === 'notice'}
    >
      <summary className="hover:bg-fg/3 focus-visible:ring-accent/50 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-2">
        {item.status === 'running' ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : item.status === 'failed' || item.kind === 'notice' ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate" title={title}>
          {title}
        </span>
        <ChevronRight
          className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden
        />
      </summary>
      <pre className="border-border text-fg-muted mt-1 ml-3 max-h-96 overflow-auto border-l py-2 pr-3 pl-4 break-words whitespace-pre-wrap">
        {item.text || 'Waiting for output…'}
      </pre>
    </details>
  );
});

export function AgentSessionView({
  session,
  visible,
  focusItemId,
  onHandoff,
}: {
  session: AgentSession;
  visible: boolean;
  focusItemId?: string;
  onHandoff?: (items: AgentItem[]) => void;
}) {
  i18n.useLocale();
  const viewId = useId();
  const { snapshot, error: snapshotError, loadOlder } = useAgentSnapshot(session.id, visible);
  const toolEnabled = useVisibleStore(
    useAgentStore,
    (s) => s.tools.some((tool) => tool.id === session.backend && tool.enabled !== false),
    visible,
  );
  const input = useVisibleStore(useAgentStore, (s) => s.drafts[session.id] ?? '', visible);
  const [, refreshRecovery] = useState(0);
  const recoveryState = (() => {
    try {
      return { record: recoverableAgentSender.recovered(session.id), error: null };
    } catch (error) {
      return { record: null, error: String(error) };
    }
  })();
  const recoveredSend = recoveryState.record;
  const setInput = (text: string) => useAgentStore.getState().setDraft(session.id, text);
  const context = useAgentContext(session.id, session.project_id);
  const [model, setModel] = useState(session.model);
  const [effort, setEffort] = useState(session.effort);
  const [mode, setMode] = useState(session.mode);
  const [agent, setAgent] = useState(session.agent);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'chat' | 'plan' | 'diff' | 'terminal'>('chat');
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [diff, setDiff] = useState('');
  const preExisting = session.pre_existing_paths ?? [];
  // Why this task started on the account it did. Absent when the user named the connection.
  const routingNote = parseRoutingNote(
    useVisibleStore(useAgentLibraryStore, (s) => s.records[`routing:${session.id}`], visible)
      ?.value,
  );
  const [diffBusy, setDiffBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [copied, setCopied] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = usePersistentBoolean(
    'runhq:agent-session-details-expanded',
    false,
  );
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [navigatedMessageId, setNavigatedMessageId] = useState<string>();
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loadingEarlierRef = useRef(false);
  const earlierAnchor = useRef<{ before: number; element: HTMLElement; top: number } | null>(null);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const sendingRef = useRef(false);
  const queued = useVisibleStore(
    useAgentQueueStore,
    (s) => s.queues[session.id] ?? emptyQueue,
    visible,
  );
  const active = agentIsActive(session.status);
  const historyOnly = agentSessionIsHistoryOnly(session);
  const readOnly = session.archived || historyOnly;
  const hasContent = agentComposerContent(input, context.entries.length, context.ready);
  const {
    catalog,
    loading: catalogBusy,
    error: catalogError,
    refresh: discover,
  } = useAgentCatalog(
    session.backend,
    session.executable,
    session.project_id,
    visible && !active && toolEnabled && !historyOnly,
    session.id,
    model,
  );
  const items = snapshot?.items ?? emptyItems;
  const userMessages = useMemo(
    () => items.filter((item) => item.kind === 'user' && !item.id.startsWith('answer:')),
    [items],
  );
  useLayoutEffect(() => {
    const anchor = earlierAnchor.current;
    if (!anchor || snapshot?.before === anchor.before || !scroll.current) return;
    scroll.current.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
    earlierAnchor.current = null;
  }, [snapshot?.before]);
  const loadEarlierMessages = async () => {
    if (loadingEarlierRef.current || !snapshot?.before) return;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    follow.current = false;
    const viewport = scroll.current;
    const top = viewport?.getBoundingClientRect().top ?? 0;
    const element = Array.from(
      viewport?.querySelectorAll<HTMLElement>('[data-agent-item]') ?? [],
    ).find((child) => child.getBoundingClientRect().bottom > top);
    earlierAnchor.current = element
      ? { before: snapshot.before, element, top: element.getBoundingClientRect().top }
      : null;
    try {
      await loadOlder();
    } finally {
      loadingEarlierRef.current = false;
      setLoadingEarlier(false);
    }
  };
  const navigateToMessage = (id: string) => {
    const viewport = scroll.current;
    const message = viewport?.querySelector<HTMLElement>(`[data-agent-item="${CSS.escape(id)}"]`);
    if (!viewport || !message) return;
    follow.current = false;
    setNavigatedMessageId(id);
    viewport.scrollTop +=
      message.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 16;
    message.focus({ preventScroll: true });
  };
  const requests = useMemo(
    () => new Map(items.filter((item) => item.kind === 'request').map((item) => [item.id, item])),
    [items],
  );
  const focused = useRef('');
  const loadingFocusPage = useRef<number | null>(null);
  useEffect(() => {
    if (!visible || !focusItemId || focused.current === focusItemId) return;
    setTab('chat');
    follow.current = false;
    const element = scroll.current?.querySelector(`[data-agent-item="${CSS.escape(focusItemId)}"]`);
    if (element) {
      element.scrollIntoView({ block: 'center' });
      focused.current = focusItemId;
    } else if (!snapshotError && snapshot?.before && loadingFocusPage.current !== snapshot.before) {
      loadingFocusPage.current = snapshot.before;
      void loadOlder();
    }
  }, [visible, focusItemId, snapshot, snapshotError, loadOlder]);
  const planMode = session.mode === 'plan' || session.agent === 'plan';
  const plans = useMemo(() => collectAgentPlans(items, planMode), [items, planMode]);
  // Requests still awaiting an answer are shown as cards below the transcript, not twice.
  const groups = useMemo(
    () =>
      groupAgentTranscript(
        items.filter(
          (item) =>
            item.kind !== 'request' ||
            !session.pending.some((request) => item.id === `request:${request.id}`),
        ),
      ),
    [items, session.pending],
  );
  const artifacts = useMemo(() => extractAgentCanvasArtifacts(items), [items]);
  useEffect(() => {
    if (visible && tab === 'chat' && follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [snapshot, visible, tab]);
  useEffect(() => {
    if (visible && session.unread)
      void ipc
        .agentUpdate(session.id, { read: true })
        .then(useAgentStore.getState().merge)
        .catch((e) => setError(String(e)));
  }, [session.id, session.unread, visible]);
  const action = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    }
  };
  const send = async (prompt = input, nextMode = mode, nextAgent = agent) => {
    if (
      (!prompt.trim() && !context.entries.length) ||
      !context.ready ||
      sendingRef.current ||
      active ||
      readOnly ||
      !toolEnabled ||
      queued.length
    )
      return;
    sendingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const message = prompt === input ? buildAgentContextPrompt(prompt, context.entries) : prompt;
      const attachments = prompt === input ? agentContextImages(context.entries) : [];
      const key = JSON.stringify({
        prompt: message,
        attachments,
        model,
        effort,
        mode: nextMode,
        agent: nextAgent,
      });
      if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
      const result = await startAgentTurnRecoverably({
        session_id: session.id,
        request_id: requestRef.current.id,
        prompt: message,
        model,
        effort,
        mode: nextMode,
        agent: nextAgent,
        attachments,
      });
      useAgentStore.getState().merge(result);
      if (prompt === input && useAgentStore.getState().drafts[session.id] === input) {
        await context.clear();
        if (useAgentStore.getState().drafts[session.id] === input) setInput('');
      }
      useAgentStore.getState().retryDraftPersistence();
      if (useAgentStore.getState().persistenceError)
        throw new Error(useAgentStore.getState().persistenceError!);
      recoverableAgentSender.complete(session.id);
      setMode(nextMode);
      setAgent(nextAgent);
      requestRef.current = null;
      follow.current = true;
      setTab('chat');
    } catch (e) {
      setError(String(e));
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };
  const enqueue = () => {
    if (
      (!input.trim() && !context.entries.length) ||
      !context.ready ||
      busy ||
      readOnly ||
      !toolEnabled
    )
      return;
    try {
      const accepted = agentTurnQueue.enqueue({
        session_id: session.id,
        request_id: crypto.randomUUID(),
        prompt: buildAgentContextPrompt(input, context.entries),
        attachments: agentContextImages(context.entries),
        model,
        effort,
        mode,
        agent,
      });
      if (accepted) {
        setInput('');
        void context.clear().catch((e) => setError(String(e)));
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const reconcileSend = async () => {
    if (!recoveredSend || active || busy || sendingRef.current || readOnly || !toolEnabled) return;
    sendingRef.current = true;
    setBusy(true);
    try {
      await action(async () => {
        const result = await startAgentTurnRecoverably(recoveredSend.turn);
        useAgentStore.getState().merge(result);
        if (
          context.ready &&
          buildAgentContextPrompt(input, context.entries) === recoveredSend.turn.prompt &&
          JSON.stringify(agentContextImages(context.entries)) ===
            JSON.stringify(recoveredSend.turn.attachments ?? [])
        ) {
          await context.clear();
          if (useAgentStore.getState().drafts[session.id] === input) setInput('');
        }
        useAgentStore.getState().retryDraftPersistence();
        if (useAgentStore.getState().persistenceError)
          throw new Error(useAgentStore.getState().persistenceError!);
        recoverableAgentSender.complete(session.id);
        refreshRecovery((value) => value + 1);
      });
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };
  const refreshDiff = async () => {
    setDiffBusy(true);
    await action(async () => setDiff(await ipc.agentWorkspaceDiff(session.id)));
    setDiffBusy(false);
  };
  const copy = async () => {
    await action(async () => {
      await writeText(items.map((item) => `## ${item.title}\n\n${item.text}`).join('\n\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  const rename = async () => {
    await action(async () => {
      const result = await ipc.agentUpdate(session.id, { title });
      useAgentStore.getState().merge(result);
      setRenaming(false);
    });
  };
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="border-border shrink-0 border-b px-4 pt-2.5 pb-2">
        <AgentSessionProject session={session} />
        <div className="flex items-center gap-2">
          <h2
            className="text-fg min-w-0 flex-1 truncate text-[13px] font-medium"
            title={session.title}
          >
            {session.title}
          </h2>
          <AgentStatusBadge status={session.status} />
          {onHandoff && (
            <button
              type="button"
              disabled={active || busy}
              onClick={() => onHandoff(items)}
              className={quietButton}
              title={i18n.t('Choose another agent and review a context handoff')}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{i18n.t('Hand off')}</span>
            </button>
          )}
          <button
            type="button"
            aria-label={
              detailsExpanded ? i18n.t('Hide session details') : i18n.t('Show session details')
            }
            aria-expanded={detailsExpanded}
            aria-controls={`${viewId}-details`}
            title={
              detailsExpanded ? i18n.t('Hide session details') : i18n.t('Show session details')
            }
            className={quietButton}
            onClick={() => setDetailsExpanded((expanded) => !expanded)}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${detailsExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
        <nav
          aria-label={i18n.t('Session views')}
          className="overlay-scroll mt-1 flex min-w-0 items-center gap-0.5 overflow-x-auto"
        >
          <button
            aria-pressed={tab === 'chat'}
            className={quietButton}
            onClick={() => {
              setTab('chat');
              setCanvasOpen(false);
            }}
          >
            {i18n.rich('{value1}Chat', { value1: <MessageSquare className="h-3.5 w-3.5" /> })}
          </button>
          <button
            aria-pressed={tab === 'plan'}
            className={quietButton}
            onClick={() => setTab('plan')}
          >
            {i18n.rich('{value1}Plan{value2}', {
              value1: <ListChecks className="h-3.5 w-3.5" />,
              value2: plans.length ? ` · ${plans.length}` : '',
            })}
          </button>
          <button
            aria-pressed={canvasOpen && tab === 'chat'}
            className={quietButton}
            onClick={() => {
              setCanvasOpen(!canvasOpen || tab !== 'chat');
              setTab('chat');
            }}
          >
            {i18n.rich('{value1}Canvas{value2}', {
              value1: <PanelsTopLeft className="h-3.5 w-3.5" />,
              value2: artifacts.length ? ` · ${artifacts.length}` : '',
            })}
          </button>
          <button
            aria-pressed={tab === 'diff'}
            className={quietButton}
            onClick={() => {
              setTab('diff');
              void refreshDiff();
            }}
          >
            {i18n.rich('{value1}Changes', { value1: <FileDiff className="h-3.5 w-3.5" /> })}
          </button>
          <button
            aria-pressed={tab === 'terminal'}
            className={quietButton}
            onClick={() => {
              setTerminalOpened(true);
              setTab('terminal');
            }}
          >
            {i18n.rich('{value1}Terminal', { value1: <TerminalSquare className="h-3.5 w-3.5" /> })}
          </button>
        </nav>
        {routingNote && (
          // Only present when RunHQ picked the account, and then it is worth seeing without
          // expanding anything: it is the one thing about this task the user did not decide.
          <p className="text-fg-dim mt-2 text-[11px]">{describeRoutingNote(routingNote)}</p>
        )}
        <div id={`${viewId}-details`} hidden={!detailsExpanded}>
          {detailsExpanded && (
            <div className="border-border mt-2 space-y-2 border-t pt-2">
              {renaming && (
                <form
                  className="flex min-w-0 flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename();
                  }}
                >
                  <input
                    aria-label={i18n.t('Session title')}
                    autoFocus
                    className="bg-surface border-border text-fg min-w-0 flex-1 basis-40 rounded border px-2 py-1 text-[13px]"
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setRenaming(false);
                    }}
                  />
                  <button className={quietButton}>{i18n.t('Save')}</button>
                  <button type="button" className={quietButton} onClick={() => setRenaming(false)}>
                    {i18n.t('Cancel')}
                  </button>
                </form>
              )}
              <div className="text-fg-dim flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <AgentProviderLogo backend={session.backend} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {session.backend_name || agentProviderNames[session.backend] || session.backend}
                  </span>
                </span>
                <span className="min-w-0 truncate">
                  {session.model || i18n.t('Agent default')}
                  {session.effort ? ` · ${session.effort}` : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  aria-label={i18n.t('Rename session')}
                  className={quietButton}
                  onClick={() => {
                    setTitle(session.title);
                    setRenaming(true);
                  }}
                >
                  {i18n.rich('{value1}Rename', { value1: <Pencil className="h-3.5 w-3.5" /> })}
                </button>
                <button
                  className={quietButton}
                  aria-label={i18n.t('Copy conversation')}
                  onClick={() => void copy()}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? i18n.t('Copied') : i18n.t('Copy')}
                </button>
                <EditorDropdown cwd={session.cwd} cmds={[]} size="sm" />
                <div className="flex-1" />
                <button
                  disabled={active}
                  className={quietButton}
                  aria-label={
                    session.archived ? i18n.t('Restore session') : i18n.t('Archive session')
                  }
                  onClick={() =>
                    void action(async () => {
                      useAgentStore
                        .getState()
                        .merge(await ipc.agentUpdate(session.id, { archived: !session.archived }));
                    })
                  }
                >
                  <Archive className="h-3.5 w-3.5" />
                  {session.archived ? i18n.t('Restore') : i18n.t('Archive')}
                </button>
              </div>
            </div>
          )}
        </div>
      </header>
      <AgentTaskLinks sessionId={session.id} />
      {(error || snapshotError || session.last_error) && (
        <div
          role="alert"
          className="text-status-error border-status-error/20 bg-status-error/5 shrink-0 border-b px-5 py-3 text-[12px] break-words"
        >
          {error || snapshotError || session.last_error}
        </div>
      )}
      {session.pending.length > 0 && tab !== 'chat' && (
        <button
          onClick={() => setTab('chat')}
          className="bg-accent/10 text-accent px-5 py-2 text-left text-[12px]"
        >
          {i18n.rich('{value1} request(s) need your response →', {
            value1: session.pending.length,
          })}
        </button>
      )}
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div
          className={`min-h-0 min-w-0 flex-1 flex-col ${canvasOpen && tab === 'chat' ? 'hidden xl:flex' : 'flex'}`}
        >
          <div className="flex min-h-0 flex-1">
            <div
              className={`relative min-h-0 min-w-0 flex-1 flex-col ${tab === 'chat' ? 'flex' : 'hidden'}`}
            >
              <div
                ref={scroll}
                onScroll={() => {
                  const el = scroll.current;
                  if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                }}
                className={`overlay-scroll min-h-0 flex-1 space-y-5 overflow-auto py-6 pr-5 lg:pr-8 ${userMessages.length || snapshot?.before ? 'pl-10 lg:pl-12' : 'pl-5 lg:pl-8'}`}
              >
                {snapshot?.before && (
                  <button
                    className={`${quietButton} mx-auto`}
                    disabled={loadingEarlier}
                    onClick={() => void loadEarlierMessages()}
                  >
                    {loadingEarlier
                      ? i18n.t('Loading earlier messages…')
                      : i18n.t('Load earlier activity')}
                  </button>
                )}
                {!snapshot && !snapshotError && (
                  <Loader2 className="text-fg-muted mx-auto h-5 w-5 animate-spin" />
                )}
                {snapshot && !items.length && (
                  <div className="text-fg-muted mx-auto max-w-md py-10 text-center text-[13px]">
                    <MessageSquare className="text-accent mx-auto mb-4 h-7 w-7" />
                    <p className="text-fg mb-2 font-medium">{i18n.t('Your workspace is ready')}</p>
                    <p>
                      {i18n.t(
                        'Describe a task. Tool activity and changes will appear here. When the agent asks a question or needs permission, you can respond in this conversation.',
                      )}
                    </p>
                  </div>
                )}
                {groups.map((group) =>
                  group.kind === 'item' ? (
                    <div
                      key={group.item.id}
                      data-agent-item={group.item.id}
                      tabIndex={group.item.kind === 'user' ? -1 : undefined}
                      className={
                        focusItemId === group.item.id || navigatedMessageId === group.item.id
                          ? 'ring-accent/40 ring-offset-surface rounded-lg ring-1 ring-offset-4 outline-none'
                          : 'outline-none'
                      }
                    >
                      <TranscriptItem
                        item={group.item}
                        providerName={session.backend_name || session.backend}
                        request={requests.get(group.item.id.replace(/^answer:/, 'request:'))}
                      />
                    </div>
                  ) : (
                    <AgentActivityBlock
                      key={group.id}
                      group={group}
                      focusItemId={focusItemId}
                      cwd={session.cwd}
                    />
                  ),
                )}
                {!!artifacts.length && !canvasOpen && (
                  <button
                    onClick={() => setCanvasOpen(true)}
                    className="border-accent/20 bg-accent/5 text-accent flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[12px]"
                  >
                    <PanelsTopLeft className="h-5 w-5" />
                    <span>
                      <strong className="block font-medium">
                        {i18n.rich('Open canvas · {value1} artifact{plural3}', {
                          value1: artifacts.length,
                          plural3: artifacts.length === 1 ? '' : 's',
                        })}
                      </strong>
                      <span className="text-fg-muted text-[11px]">
                        {i18n.t('Preview, edit and export alongside this conversation')}
                      </span>
                    </span>
                  </button>
                )}
                {planMode && !!plans.length && !active && (
                  <button
                    onClick={() => setTab('plan')}
                    className="flex items-center gap-2 rounded-lg bg-violet-400/10 px-4 py-2.5 text-[12px] text-violet-500"
                  >
                    {i18n.rich('{value1}Review your plan and build →', {
                      value1: <ListChecks className="h-4 w-4" />,
                    })}
                  </button>
                )}
                {session.pending.map((request) => (
                  <div key={request.id} data-agent-item={request.id}>
                    <AgentRequestCard
                      key={request.id}
                      request={request}
                      disabled={session.status === 'cancelling'}
                      onOpenUrl={(url) => ipc.openUrl(url)}
                      onAnswer={(value) => answerPendingAgentRequest(session.id, request.id, value)}
                    />
                  </div>
                ))}
                {active && !session.pending.length && (
                  <div className="text-fg-muted flex items-center gap-2 text-[12px]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {session.status === 'starting'
                      ? i18n.t('Connecting to your agent…')
                      : session.status === 'cancelling'
                        ? i18n.t('Waiting for the agent to stop…')
                        : i18n.t('The agent is working…')}
                  </div>
                )}
              </div>
              <AgentMessageNavigator
                messages={userMessages}
                scrollRef={scroll}
                visible={visible && tab === 'chat'}
                hasEarlier={!!snapshot?.before}
                loadingEarlier={loadingEarlier}
                onLoadEarlier={() => void loadEarlierMessages()}
                onNavigate={navigateToMessage}
              />
              <button
                aria-label={i18n.t('Follow latest activity')}
                className="bg-surface-raised border-border text-fg-muted absolute right-4 bottom-3 rounded-full border p-1.5 shadow-sm"
                onClick={() => {
                  follow.current = true;
                  scroll.current?.scrollTo({
                    top: scroll.current.scrollHeight,
                    behavior: 'smooth',
                  });
                }}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
            {tab === 'plan' && (
              <AgentPlanPanel
                sessionId={session.id}
                items={items}
                planMode={planMode}
                disabled={active || busy || readOnly || !toolEnabled || !!queued.length}
                onBuild={(body) => void send(buildAgentPlanPrompt(body), 'default', '')}
              />
            )}
            {tab === 'diff' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-border text-fg-muted flex items-start justify-between gap-3 border-b px-5 py-2 text-[11px]">
                  <div className="min-w-0">
                    <span>
                      {i18n.rich('Current checkout diff{value1}', {
                        value1: session.base_revision
                          ? i18n.t(' · task started at {value1}', {
                              value1: session.base_revision.slice(0, 7),
                            })
                          : i18n.t(' · no starting revision recorded for this directory'),
                      })}
                    </span>
                    {preExisting.length > 0 && (
                      <span className="text-fg-dim mt-0.5 block">
                        {i18n.rich(
                          '{value1} file{plural3} already had uncommitted changes when this task started, so edits there are not necessarily the agent’s: {value4}{value5}',
                          {
                            value1: preExisting.length,
                            plural3: preExisting.length === 1 ? '' : 's',
                            value4: preExisting.slice(0, 6).join(', '),
                            value5:
                              preExisting.length > 6
                                ? i18n.t(' and {value1} more', { value1: preExisting.length - 6 })
                                : '',
                          },
                        )}
                      </span>
                    )}
                  </div>
                  <button
                    className={quietButton}
                    disabled={diffBusy}
                    onClick={() => void refreshDiff()}
                  >
                    {i18n.rich('{value1}Refresh', {
                      value1: (
                        <RefreshCw className={`h-3.5 w-3.5 ${diffBusy ? 'animate-spin' : ''}`} />
                      ),
                    })}
                  </button>
                </div>
                <pre className="text-fg overlay-scroll flex-1 overflow-auto p-5 font-mono text-[12px] break-words whitespace-pre-wrap">
                  {diff ||
                    (diffBusy
                      ? i18n.t('Loading changes…')
                      : i18n.t('No tracked working-tree changes.'))}
                </pre>
              </div>
            )}
            {terminalOpened && (
              <div className={`min-h-0 flex-1 flex-col ${tab === 'terminal' ? 'flex' : 'hidden'}`}>
                <div className="text-fg-dim border-border border-b px-5 py-2 text-[11px]">
                  {i18n.t('Workspace shell · independent of the agent turn')}
                </div>
                <TerminalPane id={`agent-shell-${session.id}-${viewId}`} cwd={session.cwd} />
              </div>
            )}
          </div>
          <footer className="bg-surface shrink-0 space-y-2 px-4 pt-2 pb-4">
            <AgentUsageGuardNotice session={session} queued={queued.length > 0} />
            {historyOnly && (
              <p role="status" className="text-fg-muted bg-fg/5 rounded-lg px-3 py-2 text-[11px]">
                {i18n.t(
                  'Imported history · read-only even when restored from the archive. Add selected messages as context to a new task to continue the work.',
                )}
              </p>
            )}
            {recoveryState.error && (
              <p role="alert" className="text-status-error text-[11px]">
                {recoveryState.error}
              </p>
            )}
            {recoveredSend && (
              <div
                role="status"
                className="border-accent/20 bg-accent/5 text-fg-muted rounded-lg border px-3 py-2 text-[11px]"
              >
                {i18n.rich(
                  'A previous send needs reconciliation. Inspect the conversation before retrying.{value1}',
                  {
                    value1: (
                      <div className="mt-2 flex gap-3">
                        <button
                          disabled={active || busy || readOnly || !toolEnabled}
                          className="text-accent"
                          onClick={() => void reconcileSend()}
                        >
                          {i18n.t('Reconcile original message')}
                        </button>
                        <button
                          disabled={active || busy}
                          className="text-fg-dim"
                          onClick={() =>
                            void action(async () => {
                              recoverableAgentSender.discard(session.id);
                              refreshRecovery((value) => value + 1);
                            })
                          }
                        >
                          {i18n.t('I reviewed the result · dismiss recovery')}
                        </button>
                      </div>
                    ),
                  },
                )}
              </div>
            )}
            <AgentMessageQueue
              entries={queued}
              paused={
                queued[0]?.state === 'failed' ||
                (!active && !['completed', 'idle'].includes(session.status))
              }
              disabled={active || busy || readOnly || !toolEnabled}
              onRemove={(id) => agentTurnQueue.remove(session.id, id)}
              onMove={(id, direction) => agentTurnQueue.move(session.id, id, direction)}
              onResume={() => agentTurnQueue.resume(session.id)}
            />
            {!toolEnabled && (
              <button
                onClick={() => useAgentStore.setState({ toolsOpen: true })}
                className="text-accent text-[11px]"
              >
                {i18n.t('This tool is disabled. Open Agent tools to enable it.')}
              </button>
            )}
            <AgentComposer
              value={input}
              onChange={setInput}
              onSend={() => {
                if (active || queued.length) enqueue();
                else void send();
              }}
              busy={busy}
              compact
              disabled={readOnly || !context.ready}
              placeholder={
                historyOnly
                  ? i18n.t('Imported history is read-only')
                  : session.archived
                    ? i18n.t('Restore this session to continue')
                    : active
                      ? i18n.t('Add a follow-up to the queue…')
                      : i18n.t('Describe a task, ask a question, or continue…')
              }
              controls={
                <>
                  <AgentProviderPicker value={session.backend} name={session.backend_name} />
                  <AgentModelControls
                    catalog={catalog}
                    loading={catalogBusy}
                    refresh={discover}
                    model={model}
                    effort={effort}
                    agent={agent}
                    onAgent={(value) => {
                      setAgent(value);
                      if ((session.adapter || session.backend) === 'opencode' && value)
                        setMode(value === 'plan' ? 'plan' : 'default');
                    }}
                    mode={mode}
                    disabled={active || busy || readOnly || !toolEnabled}
                    onModel={(value) => {
                      setModel(value);
                      setEffort('');
                    }}
                    onEffort={setEffort}
                    onMode={(value) => {
                      setMode(value);
                      setAgent('');
                    }}
                  />
                  {!!catalog?.commands.length && (
                    <button
                      type="button"
                      aria-label={i18n.t('Available commands')}
                      aria-expanded={advanced}
                      onClick={() => setAdvanced(!advanced)}
                      className={`hover:bg-fg/5 rounded-lg p-2 ${advanced ? 'bg-fg/5 text-fg' : 'text-fg-dim'}`}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </button>
                  )}
                </>
              }
              action={
                active ? (
                  <>
                    <button
                      aria-label={i18n.t('Queue message')}
                      title={i18n.t('Run after the current task completes')}
                      disabled={!hasContent || busy || readOnly || !toolEnabled}
                      onClick={enqueue}
                      className={quietButton}
                    >
                      {i18n.rich('{value1}Queue', { value1: <ListPlus className="h-4 w-4" /> })}
                    </button>
                    {(session.adapter || session.backend) === 'codex' &&
                      session.status === 'running' && (
                        <button
                          disabled={
                            !agentCanSteer(session, input, context.entries.length, context.ready) ||
                            busy ||
                            !toolEnabled
                          }
                          title={
                            context.entries.length
                              ? i18n.t(
                                  'Queue this message to include its attached context. Send while working supports plain text only.',
                                )
                              : i18n.t('Send a plain-text update to the running task')
                          }
                          className={quietButton}
                          onClick={() => {
                            if (
                              !agentCanSteer(
                                session,
                                input,
                                context.entries.length,
                                context.ready,
                              ) ||
                              busy ||
                              !toolEnabled
                            )
                              return;
                            setBusy(true);
                            void action(async () => {
                              await ipc.agentSteer(session.id, input);
                              setInput('');
                            }).finally(() => setBusy(false));
                          }}
                        >
                          {i18n.t('Send while working')}
                        </button>
                      )}
                    <button
                      aria-label={i18n.t('Stop agent')}
                      title={i18n.t('Stop agent')}
                      disabled={session.status === 'cancelling'}
                      className="border-border text-fg flex h-8 w-8 items-center justify-center rounded-full border disabled:opacity-40"
                      onClick={() => void action(() => ipc.agentInterrupt(session.id))}
                    >
                      <Square className="h-3 w-3" />
                    </button>
                  </>
                ) : queued.length ? (
                  <button
                    aria-label={i18n.t('Queue message')}
                    disabled={!hasContent || busy || readOnly || !toolEnabled}
                    onClick={enqueue}
                    className={quietButton}
                  >
                    {i18n.rich('{value1}Queue', { value1: <ListPlus className="h-4 w-4" /> })}
                  </button>
                ) : (
                  <button
                    aria-label={i18n.t('Send message')}
                    title={i18n.t('Send · ⌘ / Ctrl + Enter')}
                    className="bg-fg text-surface hover:bg-fg/85 disabled:bg-fg/8 disabled:text-fg-dim flex h-8 w-8 items-center justify-center rounded-xl shadow-sm transition-colors disabled:shadow-none"
                    disabled={!hasContent || busy || readOnly || !toolEnabled}
                    onClick={() => void send()}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </button>
                )
              }
            >
              <AgentContextTray
                draftKey={session.id}
                projectId={session.project_id}
                sessionId={session.id}
                adapter={session.adapter || session.backend}
                disabled={busy || readOnly}
              />
              {advanced && !!catalog?.commands.length && (
                <fieldset
                  disabled={active || busy || readOnly || !toolEnabled}
                  className="border-border grid gap-3 border-t p-4 disabled:opacity-50 sm:grid-cols-2"
                >
                  {!!catalog?.commands.length && (
                    <details className="text-fg-dim text-[11px] sm:col-span-2">
                      <summary className="cursor-pointer">{i18n.t('Available commands')}</summary>
                      <p className="mt-2 break-words">
                        {catalog.commands.map((command) => `/${command}`).join(', ')}
                      </p>
                    </details>
                  )}
                </fieldset>
              )}
            </AgentComposer>
            {catalogError && (
              <p role="status" className="text-fg-muted text-[11px]">
                {i18n.rich(
                  'Models could not be loaded. Your current model is preserved. {value1}',
                  {
                    value1: (
                      <button onClick={discover} className="text-accent">
                        {i18n.t('Retry')}
                      </button>
                    ),
                  },
                )}
              </p>
            )}
            <p className="text-fg-dim px-1 text-[11px]">
              {active
                ? i18n.t('You can switch projects while this task runs.')
                : i18n.t('⌘ / Ctrl + Enter to send')}
            </p>
            {session.usage != null && (
              <details className="text-fg-dim text-[11px]">
                <summary className="cursor-pointer">{i18n.t('Reported usage')}</summary>
                <AgentUsageCard usage={session.usage} />
              </details>
            )}
          </footer>
        </div>
        {tab === 'chat' && canvasOpen && (
          <aside
            aria-label={i18n.t('Session canvas')}
            className="border-border bg-surface-raised flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col xl:h-auto xl:w-[48%] xl:border-l"
          >
            <AgentCanvasPanel sessionId={session.id} items={items} />
          </aside>
        )}
      </div>
    </section>
  );
}
