'use client';

import * as i18n from '../i18n';
import { ArrowDown, ArrowUp, ListOrdered, Loader2, Play, X } from 'lucide-react';

export function AgentMessageQueue({
  entries,
  paused,
  disabled,
  onRemove,
  onMove,
  onResume,
  onStartNow,
  onOpenDependency,
}: {
  entries: {
    request_id: string;
    prompt: string;
    state: string;
    error?: string;
    startAfter?: { sessionId: string; title: string };
  }[];
  paused: boolean;
  disabled?: boolean;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onResume: () => void;
  onStartNow?: () => void;
  onOpenDependency?: (sessionId: string) => void;
}) {
  i18n.useLocale();
  if (!entries.length) return null;
  const button = 'text-fg-dim hover:text-fg rounded p-1 disabled:opacity-25';
  const preceding = entries[0]?.startAfter;
  return (
    <section
      aria-label={i18n.t('Queued messages')}
      className="border-border bg-surface-raised rounded-xl border px-3 py-2"
    >
      <div className="flex items-center gap-2 text-[11px]">
        <ListOrdered className="text-accent h-3.5 w-3.5" />
        <span className="text-fg font-medium">
          {i18n.rich('Up next · {value1}', { value1: entries.length })}
        </span>
        <span className="text-fg-dim min-w-0 flex-1">
          {paused
            ? i18n.t('Paused')
            : preceding
              ? i18n.t('Waiting for: {value1}', { value1: preceding.title })
              : i18n.t('Runs after this task completes')}
        </span>
        {preceding && onStartNow && (
          <button
            type="button"
            disabled={disabled || entries[0]?.state === 'sending'}
            onClick={onStartNow}
            className="text-accent disabled:opacity-40"
          >
            {i18n.t('Start now')}
          </button>
        )}
        {paused && (
          <button
            disabled={disabled}
            onClick={onResume}
            className="text-accent flex items-center gap-1 disabled:opacity-40"
          >
            {i18n.rich('{value1}Resume queue', { value1: <Play className="h-3 w-3" /> })}
          </button>
        )}
      </div>
      {preceding && onOpenDependency && (
        <button
          type="button"
          onClick={() => onOpenDependency(preceding.sessionId)}
          className="text-accent mt-1 text-[11px] underline"
        >
          {i18n.t('Waiting for: {value1}', { value1: preceding.title })}
        </button>
      )}
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
                aria-label={i18n.t('Move queued message {value1} up', { value1: index + 1 })}
                disabled={
                  index === 0 ||
                  entry.state !== 'queued' ||
                  entries[index - 1]?.state !== 'queued' ||
                  !!entry.startAfter ||
                  !!entries[index - 1]?.startAfter
                }
                onClick={() => onMove(entry.request_id, -1)}
                className={button}
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                aria-label={i18n.t('Move queued message {value1} down', { value1: index + 1 })}
                disabled={
                  index === entries.length - 1 ||
                  entry.state !== 'queued' ||
                  entries[index + 1]?.state !== 'queued' ||
                  !!entry.startAfter ||
                  !!entries[index + 1]?.startAfter
                }
                onClick={() => onMove(entry.request_id, 1)}
                className={button}
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                aria-label={i18n.t('Remove queued message {value1}', { value1: index + 1 })}
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
        {i18n.t(
          'Queue stays active while RunHQ is open. After restarting the app, review and resume saved messages.',
        )}
      </p>
    </section>
  );
}
