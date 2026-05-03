import { Check, Copy } from 'lucide-react';
import type { makeAnsiConverter } from '@/lib/ansi';
import { cn } from '@/lib/cn';
import { ConsoleOutput } from '@/components/activity/ConsoleOutput';
import { Dialog } from '@/components/ui/Dialog';
import type { TimelineEvent } from '@/types';
import { EventBadge } from './EventBadge';
import { defaultConfig, eventConfig, formatTime, splitEventDescription } from './model';
import type { ConsoleSectionsFor } from './types';

interface ActivityEventModalProps {
  ansi: ReturnType<typeof makeAnsiConverter>;
  consoleSectionsFor: ConsoleSectionsFor;
  detailCopied: boolean;
  event: TimelineEvent | null;
  isDark: boolean;
  onClose: () => void;
  onCopy: (event: TimelineEvent) => void;
}

export function ActivityEventModal({
  ansi,
  consoleSectionsFor,
  detailCopied,
  event,
  isDark,
  onClose,
  onCopy,
}: ActivityEventModalProps) {
  if (!event) return null;
  const cfg = eventConfig[event.event_type] ?? defaultConfig;
  const { heading, body } = splitEventDescription(event);
  const metaLine = [
    formatTime(event.timestamp),
    `#${event.id}`,
    event.service_name,
    event.event_type,
  ]
    .filter(Boolean)
    .join(' · ');
  const consoleSections = consoleSectionsFor(event);
  const consoleLineCount = consoleSections.reduce(
    (total, section) => total + section.lines.length,
    0,
  );

  return (
    <Dialog
      title={cfg.label}
      subtitle={metaLine}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="text-fg/60 hover:text-fg/90 hover:bg-fg/8 rounded-md px-3 py-1.5 text-[12px] font-medium transition"
          >
            Close
          </button>
          <button
            onClick={() => onCopy(event)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition',
              detailCopied
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-accent/10 text-accent hover:bg-accent/15',
            )}
          >
            {detailCopied ? <Check size={13} /> : <Copy size={13} />}
            {detailCopied ? 'Copied' : 'Copy'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <EventBadge cfg={cfg} size="text-[10px]" />
          {event.service_name && (
            <span className="text-fg/50 text-[12px] font-medium" title={event.service_name}>
              {event.service_name}
            </span>
          )}
          <span className="text-fg/40 ml-auto font-mono text-[11px] tabular-nums">
            {formatTime(event.timestamp)}
          </span>
        </div>

        <h3 className="text-fg text-[15px] leading-snug font-semibold wrap-break-word">
          {heading}
        </h3>

        {body && (
          <pre className="overlay-scroll text-fg/75 border-border/40 bg-fg/3 max-h-[40vh] overflow-auto rounded-md border px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
            {body}
          </pre>
        )}

        {consoleLineCount > 0 && (
          <ConsoleOutput
            sections={consoleSections}
            ansi={ansi}
            isDark={isDark}
            microSize="text-[10.5px]"
            metaSize="text-[12px]"
            maxHeightClass="max-h-[45vh]"
          />
        )}
      </div>
    </Dialog>
  );
}
