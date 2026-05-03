import { AlertTriangle, Check, Copy, FileEdit, Maximize2, X, XCircle, Zap } from 'lucide-react';
import type { makeAnsiConverter } from '@/lib/ansi';
import { cn } from '@/lib/cn';
import { ConsoleOutput } from '@/components/activity/ConsoleOutput';
import type { ConsoleSection } from '@/components/activity/consoleModel';
import type { TimelineEvent } from '@/types';
import { EventBadge } from './EventBadge';
import { defaultConfig, eventConfig, formatTime, splitEventDescription, timeAgo } from './model';
import type { TimelineSize } from './types';

interface ActivityEventRowProps {
  ansi: ReturnType<typeof makeAnsiConverter>;
  consoleSections: ConsoleSection[];
  detailCopied: boolean;
  event: TimelineEvent;
  isDark: boolean;
  isFirst: boolean;
  isInline: boolean;
  isLast: boolean;
  now: number;
  onClose: () => void;
  onCopy: (event: TimelineEvent) => void;
  onOpenModal: () => void;
  onToggle: () => void;
  selected: boolean;
  size: TimelineSize;
}

export function ActivityEventRow({
  ansi,
  consoleSections,
  detailCopied,
  event,
  isDark,
  isFirst,
  isInline,
  isLast,
  now,
  onClose,
  onCopy,
  onOpenModal,
  onToggle,
  selected,
  size,
}: ActivityEventRowProps) {
  const cfg = eventConfig[event.event_type] ?? defaultConfig;
  const tsMs = new Date(event.timestamp).getTime();
  const isFresh = Date.now() - tsMs < 10_000;
  const consoleLineCount = consoleSections.reduce(
    (total, section) => total + section.lines.length,
    0,
  );
  const childStats =
    consoleLineCount > 0
      ? {
          total: consoleLineCount,
          errors: consoleSections.reduce((total, section) => total + section.errors, 0),
          warnings: consoleSections.reduce((total, section) => total + section.warnings, 0),
          files: 0,
        }
      : null;
  const sevTint =
    cfg.severity === 2
      ? 'hover:bg-rose-500/3'
      : cfg.severity === 1
        ? 'hover:bg-amber-500/2.5'
        : 'hover:bg-fg/2.5';
  const iconCenter = 12 + size.sevIcon / 2;
  const railLeftPx = (isInline ? 16 : 24) + size.sevIcon / 2;
  const { heading, body } = splitEventDescription(event);

  return (
    <div
      className={cn(
        'group relative transition-colors',
        sevTint,
        selected && 'bg-fg/3',
        cfg.severity === 2 && 'bg-rose-500/2',
      )}
    >
      {!isFirst && (
        <span
          aria-hidden
          className="bg-border/70 absolute top-0 w-px -translate-x-1/2"
          style={{ left: railLeftPx, height: iconCenter }}
        />
      )}
      {!isLast && (
        <span
          aria-hidden
          className="bg-border/70 absolute bottom-0 w-px -translate-x-1/2"
          style={{ left: railLeftPx, top: iconCenter }}
        />
      )}
      <button
        type="button"
        onClick={onToggle}
        className={cn('flex w-full items-start gap-3 text-left', size.padX, 'py-3')}
        aria-expanded={selected}
      >
        <div
          className={cn(
            'bg-surface border-border relative z-10 flex shrink-0 items-center justify-center rounded-full border transition',
            'group-hover:border-fg/30',
            selected && 'border-fg/40',
          )}
          style={{ height: size.sevIcon, width: size.sevIcon }}
        >
          <Zap
            size={Math.floor(size.sevIcon / 1.8)}
            className="text-fg/55 shrink-0"
            strokeWidth={2.25}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <EventBadge cfg={cfg} size={size.micro} />
            {event.service_name && (
              <span
                className={cn('text-fg/45 min-w-0 truncate font-medium', size.meta)}
                title={event.service_name}
              >
                {event.service_name}
              </span>
            )}
            {isFresh && (
              <span
                className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-400"
                title="Just now"
              >
                <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-400" />
                <span className={cn('tracking-wide uppercase', size.micro)}>new</span>
              </span>
            )}
            {childStats && childStats.total > 0 && (
              <span
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tabular-nums',
                  size.micro,
                  childStats.errors > 0
                    ? 'bg-rose-500/10 text-rose-400'
                    : childStats.warnings > 0
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-fg/5 text-fg/55',
                )}
                title={[
                  childStats.errors > 0 &&
                    `${childStats.errors} error${childStats.errors === 1 ? '' : 's'}`,
                  childStats.warnings > 0 &&
                    `${childStats.warnings} warning${childStats.warnings === 1 ? '' : 's'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                {childStats.errors > 0 ? (
                  <XCircle size={10} />
                ) : childStats.warnings > 0 ? (
                  <AlertTriangle size={10} />
                ) : (
                  <FileEdit size={10} />
                )}
                {childStats.total}
              </span>
            )}
            <span
              className={cn('text-fg/40 ml-auto shrink-0 tabular-nums', size.meta)}
              title={`${formatTime(event.timestamp)} · id #${event.id}`}
            >
              {timeAgo(tsMs, now)}
            </span>
          </div>

          {!selected && (
            <p
              className={cn(
                'text-fg/70 mt-1.5 line-clamp-2 leading-relaxed wrap-break-word',
                size.body,
              )}
            >
              {event.description}
            </p>
          )}

          {selected && (
            <div
              className="mt-3"
              onClick={(clickEvent) => clickEvent.stopPropagation()}
              role="presentation"
            >
              <h4 className={cn('text-fg leading-snug font-semibold wrap-break-word', size.title)}>
                {heading}
              </h4>
              {body && (
                <pre
                  className={cn(
                    'overlay-scroll text-fg/70 border-border/30 bg-fg/3 mt-3 max-h-72 overflow-auto rounded-md border px-3 py-2.5 font-mono leading-relaxed whitespace-pre-wrap',
                    size.meta,
                  )}
                >
                  {body}
                </pre>
              )}
              <div className="mt-3 flex items-center gap-3">
                <span
                  className={cn('text-fg/40 flex items-center gap-1.5 tabular-nums', size.micro)}
                  title={`${formatTime(event.timestamp)} · id #${event.id}`}
                >
                  <span className="font-mono">{formatTime(event.timestamp)}</span>
                  <span className="text-fg/20">·</span>
                  <span className="font-mono">#{event.id}</span>
                </span>

                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onCopy(event)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition',
                      size.meta,
                      detailCopied
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'hover:bg-fg/8 text-fg/60 hover:text-fg/85',
                    )}
                    title="Copy event"
                  >
                    {detailCopied ? <Check size={12} /> : <Copy size={12} />}
                    {detailCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenModal}
                    className={cn(
                      'hover:bg-fg/8 text-fg/60 hover:text-fg/85 flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition',
                      size.meta,
                    )}
                    title="Open full view"
                  >
                    <Maximize2 size={12} />
                    Full view
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="hover:bg-fg/8 text-fg/40 hover:text-fg/70 rounded-md p-1.5 transition"
                    title="Close (Esc)"
                    aria-label="Close"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>

              {consoleSections.length > 0 && (
                <ConsoleOutput
                  sections={consoleSections}
                  ansi={ansi}
                  isDark={isDark}
                  microSize={size.micro}
                  metaSize={size.meta}
                />
              )}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
