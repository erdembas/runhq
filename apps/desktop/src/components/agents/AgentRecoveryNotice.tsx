import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { useAgentQueueStore } from '@/store/useAgentQueueStore';
import { useAgentStore } from '@/store/useAgentStore';

export function AgentRecoveryNotice({ onOpenSession }: { onOpenSession?: (id: string) => void }) {
  i18n.useLocale();
  const [dismissed, setDismissed] = useState(false);
  const queueError = useAgentQueueStore((state) => state.persistenceError);
  const recoveredIds = useAgentQueueStore((state) => state.recoveredSessionIds);
  const draftError = useAgentStore((state) => state.persistenceError);
  const draftCount = useAgentStore((state) => state.recoveredDraftCount);
  const sessions = useAgentStore((state) => state.sessions);
  const error = queueError || draftError;
  if (!error && (dismissed || (!recoveredIds.length && !draftCount))) return null;
  return (
    <div
      role={error ? 'alert' : 'status'}
      className="border-border bg-accent/5 flex items-start gap-2 border-b px-4 py-3 text-[12px]"
    >
      {error ? (
        <AlertTriangle className="text-status-error mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <RotateCcw className="text-accent mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className={error ? 'text-status-error' : 'text-fg'}>
          {error ||
            `${draftCount ? i18n.t('{draftCount} draft{plural2} restored. ', { draftCount: draftCount, plural2: draftCount === 1 ? '' : 's' }) : ''}${recoveredIds.length ? i18n.t('{value1} queue{plural2} recovered and paused. Review each task before resuming.', { value1: recoveredIds.length, plural2: recoveredIds.length === 1 ? '' : 's' }) : i18n.t('Your unsent text is ready in its task or project.')}`}
        </p>
        {error && (
          <button
            type="button"
            className="text-accent underline"
            onClick={() => {
              useAgentQueueStore.getState().retryPersistence();
              useAgentStore.getState().retryDraftPersistence();
            }}
          >
            {i18n.t('Retry local save')}
          </button>
        )}
        {!!recoveredIds.length && onOpenSession && (
          <div className="flex flex-wrap gap-2">
            {recoveredIds.map((id) => (
              <button
                key={id}
                type="button"
                className="text-accent truncate underline"
                onClick={() => onOpenSession(id)}
              >
                {i18n.rich('Review {value1}', {
                  value1: sessions[id]?.title ?? i18n.t('recovered task'),
                })}
              </button>
            ))}
          </div>
        )}
      </div>
      {!error && (
        <button
          type="button"
          aria-label={i18n.t('Dismiss recovery notice')}
          className="text-fg-dim p-1"
          onClick={() => setDismissed(true)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
