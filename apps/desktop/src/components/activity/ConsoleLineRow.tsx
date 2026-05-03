import { useMemo } from 'react';
import { renderAnsiToHtml, type makeAnsiConverter } from '@/lib/ansi';
import { cn } from '@/lib/cn';
import type { ConsoleLine } from '@/components/activity/consoleModel';

interface ConsoleLineRowProps {
  ansi: ReturnType<typeof makeAnsiConverter>;
  line: ConsoleLine;
  metaSize: string;
  microSize: string;
}

export function ConsoleLineRow({ ansi, line, metaSize, microSize }: ConsoleLineRowProps) {
  const html = useMemo(() => renderAnsiToHtml(ansi, line.text), [ansi, line.text]);
  const gutter =
    line.severity === 'error'
      ? 'border-l-2 border-rose-500/60'
      : line.severity === 'warn'
        ? 'border-l-2 border-amber-500/50'
        : line.severity === 'system'
          ? 'border-l-2 border-accent/50'
          : 'border-l-2 border-transparent';

  return (
    <div
      className={cn(
        'flex w-max min-w-full items-start gap-2.5 px-3 py-0.5 leading-relaxed hover:bg-white/4',
        gutter,
      )}
    >
      <span
        className={cn('shrink-0 tabular-nums opacity-60 select-none', microSize)}
        title={new Date(line.ts_ms).toLocaleTimeString()}
      >
        {formatConsoleTimeFromMs(line.ts_ms)}
      </span>
      <span
        className={cn('shrink-0 whitespace-pre', metaSize)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function formatConsoleTimeFromMs(tsMs: number): string {
  try {
    const date = new Date(tsMs);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return '';
  }
}
