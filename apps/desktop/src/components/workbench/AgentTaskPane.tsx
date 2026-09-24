import { useEffect } from 'react';
import type { AgentItem } from '@runhq/cockpit-types';
import { CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { AgentSessionView } from '@/components/agents/AgentSessionView';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { openAgentTask, openWorkflow, requestTaskHandoff } from '@/lib/workbenchNavigation';
import { connectAgents, useAgentStore } from '@/store/useAgentStore';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';

/** The conversation host keeps this pane mounted while other chats or project sections are shown. */
export function AgentTaskPane({
  sessionId,
  visible,
  onHandoff,
}: {
  sessionId: string;
  visible: boolean;
  onHandoff?: (items: AgentItem[]) => void;
}) {
  i18n.useLocale();
  const session = useVisibleStore(useAgentStore, (state) => state.sessions[sessionId], visible);
  const ready = useVisibleStore(useAgentStore, (state) => state.ready, visible);
  const error = useVisibleStore(useAgentStore, (state) => state.error, visible);
  const origin = useVisibleStore(
    useWorkbenchStore,
    (state) => state.taskOrigins[sessionId],
    visible,
  );
  const focusRequest = useVisibleStore(
    useWorkbenchStore,
    (state) => state.taskFocusItems[sessionId],
    visible,
  );
  const focusMode = useVisibleStore(useWorkbenchStore, (state) => state.focusMode, visible);

  useEffect(() => {
    if (visible) void connectAgents();
  }, [visible]);

  if (!session) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div
          className="text-fg-muted flex max-w-md flex-col items-center gap-3 text-center text-[13px]"
          role={error ? 'alert' : 'status'}
        >
          {!ready ? (
            <>
              <Loader2 className="text-fg-dim h-5 w-5 animate-spin" aria-hidden />
              <p>{i18n.t('Loading task…')}</p>
            </>
          ) : (
            <>
              <CircleAlert className="text-fg-dim h-5 w-5" aria-hidden />
              <h2 className="text-fg font-medium">
                {error ? i18n.t('Could not load this task.') : i18n.t('Task unavailable')}
              </h2>
              <p>
                {error ||
                  i18n.t('This task may have been deleted. Your other open work is preserved.')}
              </p>
              <button
                type="button"
                className="border-border hover:bg-fg/5 focus-visible:ring-accent/50 flex items-center gap-2 rounded-md border px-3 py-1.5 outline-none focus-visible:ring-2"
                onClick={() => void connectAgents().then(() => useAgentStore.getState().refresh())}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {i18n.t('Retry')}
              </button>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <AgentSessionView
      key={session.id}
      session={session}
      visible={visible}
      focusItemId={focusRequest?.itemId}
      focusItemRevision={focusRequest?.revision}
      onHandoff={onHandoff ?? ((items) => requestTaskHandoff(session.id, items))}
      onOpenSession={openAgentTask}
      onBackToWorkflow={
        origin?.workflowId
          ? () => openWorkflow(origin.workflowId!, origin.projectId ?? session.project_id)
          : undefined
      }
      focusMode={focusMode}
      onToggleFocus={() => {
        const workbench = useWorkbenchStore.getState();
        workbench.setFocusMode(!workbench.focusMode);
      }}
    />
  );
}
