import { useState } from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { useAgentQueueStore } from '@/store/useAgentQueueStore';
import { useAgentStore } from '@/store/useAgentStore';

export function AgentRecoveryNotice({ onOpenSession }: { onOpenSession?: (id: string) => void }) {
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
            `${draftCount ? `${draftCount} draft${draftCount === 1 ? '' : 's'} restored. ` : ''}${recoveredIds.length ? `${recoveredIds.length} queue${recoveredIds.length === 1 ? '' : 's'} recovered and paused. Review each task before resuming.` : 'Your unsent text is ready in its task or project.'}`}
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
            Retry local save
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
                Review {sessions[id]?.title ?? 'recovered task'}
              </button>
            ))}
          </div>
        )}
      </div>
      {!error && (
        <button
          type="button"
          aria-label="Dismiss recovery notice"
          className="text-fg-dim p-1"
          onClick={() => setDismissed(true)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
