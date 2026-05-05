'use client';

import { useMemo } from 'react';
import { cn } from '../lib/cn';

export interface LogLineFixture {
  /** Stream class — drives the leading prefix and tone. */
  kind: 'stdout' | 'stderr' | 'system' | 'prompt';
  /** Plain text. ANSI escape sequences are NOT supported here on
   *  purpose — the marketing surface ships zero parser code. To show
   *  colored text, split the line into <Span tone="…"> children via the
   *  `segments` field instead. */
  text?: string;
  /** Inline-styled segments (e.g. coloured words). When present `text`
   *  is ignored. */
  segments?: Array<{ tone?: 'accent' | 'success' | 'warn' | 'error' | 'dim'; text: string }>;
  /** Optional left-margin timestamp ("12:04:18"). */
  ts?: string;
}

interface Props {
  /** Window header label, e.g. `acme-api · npm run dev`. */
  title?: string;
  /** Optional pill on the right of the header (status, port, etc.). */
  rightSlot?: React.ReactNode;
  lines: LogLineFixture[];
  /** Append a blinking caret to the last line so the demo feels live. */
  caret?: boolean;
  className?: string;
}

const TONE: Record<NonNullable<NonNullable<LogLineFixture['segments']>[number]['tone']>, string> = {
  accent: 'text-accent',
  success: 'text-status-running',
  warn: 'text-status-starting',
  error: 'text-status-error',
  dim: 'text-fg-dim',
};

const KIND_PREFIX: Record<LogLineFixture['kind'], { glyph: string; tone: string } | null> = {
  stdout: null,
  stderr: { glyph: '!', tone: 'text-status-error' },
  system: { glyph: '·', tone: 'text-fg-dim' },
  prompt: { glyph: '$', tone: 'text-accent' },
};

/**
 * Pure-React terminal mock for the marketing site.
 *
 * Deliberately does *not* embed `xterm.js` — that would add ~120 KB
 * gzipped to the LCP-critical bundle and bring along a heavyweight
 * canvas renderer that the marketing surface has no live PTY data for
 * anyway. The desktop's real `LogXtermView` continues to use xterm —
 * this component is purely for visual storytelling.
 */
export function LogTerminalMock({ title, rightSlot, lines, caret = true, className }: Props) {
  const renderedLines = useMemo(
    () =>
      lines.map((line, idx) => {
        const prefix = KIND_PREFIX[line.kind];
        const isLast = idx === lines.length - 1;
        return (
          <div key={idx} className="flex items-baseline gap-2 leading-[1.55]">
            {line.ts && <span className="text-fg-dim/70 select-none">{line.ts}</span>}
            {prefix && (
              <span className={cn('w-3 shrink-0 select-none', prefix.tone)}>{prefix.glyph}</span>
            )}
            <span className="min-w-0 flex-1">
              {line.segments
                ? line.segments.map((seg, sidx) => (
                    <span key={sidx} className={seg.tone ? TONE[seg.tone] : undefined}>
                      {seg.text}
                    </span>
                  ))
                : line.text}
              {caret && isLast && (
                <span className="bg-accent ml-0.5 inline-block h-3 w-1.5 align-[-2px] motion-safe:animate-pulse" />
              )}
            </span>
          </div>
        );
      }),
    [lines, caret],
  );

  return (
    <div
      className={cn(
        'border-border bg-surface flex flex-col overflow-hidden rounded-xl border',
        className,
      )}
    >
      {(title || rightSlot) && (
        <div className="border-border bg-surface-muted/60 flex items-center gap-2 border-b px-3 py-2">
          {title && (
            <div className="text-fg-muted truncate font-mono text-[11.5px]">
              <span className="text-fg-dim">›_ </span>
              {title}
            </div>
          )}
          {rightSlot && <div className="ml-auto">{rightSlot}</div>}
        </div>
      )}
      <div className="text-fg-muted/95 scrollbar-thin overflow-x-auto px-3 py-2.5 font-mono text-[11.5px]">
        {renderedLines}
      </div>
    </div>
  );
}
