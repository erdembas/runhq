import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock3, Play } from 'lucide-react';
import type { AgentSession } from '@runhq/cockpit-types';
import { AGENT_STATUS_LABELS, SearchableSelect } from '@runhq/cockpit-ui';
import { Dialog } from '@/components/ui/Dialog';
import { Radio } from '@/components/ui/Choice';
import type { WorkflowLaunchChoice } from './agentWorkflowLaunch';

const button =
  'border-border hover:bg-fg/5 rounded-lg border px-3 py-2 text-xs disabled:opacity-40';

export function AgentWorkflowLaunchDialog({
  tasks,
  busy,
  canSaveDraft,
  onChoose,
  onClose,
  error,
  kind = 'workflow',
}: {
  tasks: AgentSession[];
  busy: boolean;
  error?: string | null;
  kind?: 'workflow' | 'task';
  canSaveDraft: boolean;
  onChoose: (choice: WorkflowLaunchChoice) => void;
  onClose: () => void;
}) {
  i18n.useLocale();
  const [mode, setMode] = useState<'after' | 'now'>(tasks.length ? 'after' : 'now');
  const [sessionId, setSessionId] = useState(tasks[0]?.id ?? '');
  const root = useRef<HTMLDivElement>(null);
  const selected = tasks.find((task) => task.id === sessionId);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = [
        ...(root.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
        ) ?? []),
      ];
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div ref={root}>
      <Dialog
        title={
          kind === 'task'
            ? i18n.t('When should this task start?')
            : i18n.t('When should this workflow start?')
        }
        onClose={() => {
          if (!busy) onClose();
        }}
        footer={
          <>
            {canSaveDraft && (
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => onChoose({ mode: 'draft' })}
              >
                {i18n.t('Save for later')}
              </button>
            )}
            <button type="button" className={button} disabled={busy} onClick={onClose}>
              {i18n.t('Cancel')}
            </button>
            <button
              type="button"
              className={`${button} bg-accent text-accent-fg`}
              disabled={busy || (mode === 'after' && !selected)}
              onClick={() => onChoose(mode === 'after' ? { mode, sessionId } : { mode })}
            >
              {busy
                ? i18n.t('Saving…')
                : mode === 'after'
                  ? kind === 'task'
                    ? i18n.t('Queue task')
                    : i18n.t('Wait & start separately')
                  : i18n.t('Start now')}
            </button>
          </>
        }
      >
        <p className="text-fg-muted mb-4 text-xs">
          {i18n.t('There is active work in this project. Choose how your new prompts should run.')}
        </p>
        {error && (
          <p role="alert" className="text-status-error mb-3 text-xs">
            {error}
          </p>
        )}
        <div className="space-y-3">
          <label
            className={`flex gap-3 rounded-xl border p-3 ${mode === 'after' ? 'border-accent bg-accent/5' : 'border-border'}`}
          >
            <Radio
              name="workflow-launch"
              value="after"
              checked={mode === 'after'}
              disabled={busy || !tasks.length}
              onChange={() => setMode('after')}
            />
            <span className="space-y-1 text-xs">
              <span className="text-fg flex items-center gap-2 font-medium">
                {i18n.rich('{value1}Wait for a task to finish', {
                  value1: <Clock3 className="size-4" />,
                })}
              </span>
              <span className="text-fg-muted block">
                {kind === 'task'
                  ? i18n.t(
                      'Wait for the selected task to finish successfully, then start this task automatically.',
                    )
                  : i18n.t(
                      'Wait for a successful finish, then start independently in a separate working copy. The other task’s conversation and changes are not carried over.',
                    )}
              </span>
            </span>
          </label>
          <label className="text-fg-muted block space-y-1.5 text-xs">
            <span>{i18n.t('Wait for task')}</span>
            <SearchableSelect
              label={i18n.t('Wait for task')}
              placeholder={i18n.t('Choose an active task')}
              className="w-full"
              value={selected?.id ?? ''}
              disabled={busy || mode !== 'after' || !tasks.length}
              onChange={setSessionId}
              options={tasks.map((task) => ({
                value: task.id,
                label: task.title,
                description: `${task.backend_name || task.backend} · ${AGENT_STATUS_LABELS[task.status]}`,
              }))}
            />
          </label>
          {!tasks.length && (
            <p role="status" className="text-fg-dim text-xs">
              {i18n.t('The active tasks have finished. You can start now.')}
            </p>
          )}
          <label
            className={`flex gap-3 rounded-xl border p-3 ${mode === 'now' ? 'border-accent bg-accent/5' : 'border-border'}`}
          >
            <Radio
              name="workflow-launch"
              value="now"
              checked={mode === 'now'}
              disabled={busy}
              onChange={() => setMode('now')}
            />
            <span className="space-y-1 text-xs">
              <span className="text-fg flex items-center gap-2 font-medium">
                {i18n.rich('{value1}Start now', { value1: <Play className="size-4" /> })}
              </span>
              <span className="text-fg-muted block">
                {kind === 'task'
                  ? i18n.t('Start this task now and run alongside the other tasks in this project.')
                  : i18n.t(
                      'Run independently in a separate working copy. Account capacity limits still apply.',
                    )}
              </span>
            </span>
          </label>
          <p className="text-fg-dim text-[11px]">
            {kind === 'task'
              ? i18n.t(
                  'Both options use the workspace and settings selected for this task. Waiting does not copy the other task’s conversation.',
                )
              : i18n.t(
                  'Both options use this workflow’s prompts, models and reviews. Waiting controls start time; it does not copy the other task’s conversation or uncommitted changes.',
                )}
          </p>
        </div>
      </Dialog>
    </div>,
    document.body,
  );
}
