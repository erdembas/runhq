'use client';

import { ArrowDown, ArrowUp, ListOrdered, Loader2, Play, X } from 'lucide-react';

export function AgentMessageQueue({
  entries,
  paused,
  disabled,
  onRemove,
  onMove,
  onResume,
}: {
  entries: { request_id: string; prompt: string; state: string; error?: string }[];
  paused: boolean;
  disabled?: boolean;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onResume: () => void;
}) {
  if (!entries.length) return null;
  const button = 'text-fg-dim hover:text-fg rounded p-1 disabled:opacity-25';
  return (
    <section
      aria-label="Queued messages"
      className="border-border bg-surface-raised rounded-xl border px-3 py-2"
    >
      <div className="flex items-center gap-2 text-[11px]">
        <ListOrdered className="text-accent h-3.5 w-3.5" />
        <span className="text-fg font-medium">Up next · {entries.length}</span>
        <span className="text-fg-dim min-w-0 flex-1">
          {paused ? 'Paused' : 'Runs after this task completes'}
        </span>
        {paused && (
          <button
            disabled={disabled}
            onClick={onResume}
            className="text-accent flex items-center gap-1 disabled:opacity-40"
          >
            <Play className="h-3 w-3" />
            Resume queue
          </button>
        )}
      </div>
      <ol className="mt-1 max-h-36 overflow-auto">
        {entries.map((entry, index) => (
          <li key={entry.request_id} className="border-border/50 border-t py-1.5 first:border-0">
            <div className="flex items-center gap-2">
              <span className="text-fg-dim w-3 text-[10px]">
                {entry.state === 'sending' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  index + 1
                )}
              </span>
              <p className="text-fg-muted min-w-0 flex-1 truncate text-[12px]" title={entry.prompt}>
                {entry.prompt}
              </p>
              <button
                aria-label={`Move queued message ${index + 1} up`}
                disabled={
                  index === 0 || entry.state !== 'queued' || entries[index - 1]?.state !== 'queued'
                }
                onClick={() => onMove(entry.request_id, -1)}
                className={button}
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                aria-label={`Move queued message ${index + 1} down`}
                disabled={
                  index === entries.length - 1 ||
                  entry.state !== 'queued' ||
                  entries[index + 1]?.state !== 'queued'
                }
                onClick={() => onMove(entry.request_id, 1)}
                className={button}
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                aria-label={`Remove queued message ${index + 1}`}
                disabled={entry.state === 'sending'}
                onClick={() => onRemove(entry.request_id)}
                className={button}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {entry.error && (
              <p role="alert" className="text-status-error mt-1 pl-5 text-[11px] break-words">
                {entry.error}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="text-fg-dim mt-1 text-[10px]">
        Queue stays active across tabs while RunHQ is open. Closing the app clears it.
      </p>
    </section>
  );
}
