import type { LogLine, TimelineEvent } from '@/types';

export interface ConsoleLine {
  key: string;
  ts_ms: number;
  text: string;
  severity: 'error' | 'warn' | 'info' | 'system';
}

export interface ConsoleSection {
  key: string;
  label: string;
  lines: ConsoleLine[];
  errors: number;
  warnings: number;
}

function severityOfLive(line: LogLine): ConsoleLine['severity'] {
  if (line.stream === 'system') return 'system';
  const text = line.text.toLowerCase();
  if (text.includes('error') || text.includes('fatal') || text.includes('panic')) return 'error';
  if (text.includes('warn')) return 'warn';
  return 'info';
}

export function toConsoleLineFromLive(line: LogLine): ConsoleLine {
  return {
    key: `live-${line.seq}`,
    ts_ms: line.ts_ms,
    text: line.text,
    severity: severityOfLive(line),
  };
}

export function toConsoleLineFromDb(child: TimelineEvent): ConsoleLine {
  const severity: ConsoleLine['severity'] =
    child.event_type === 'log_error'
      ? 'error'
      : child.event_type === 'log_warning'
        ? 'warn'
        : 'info';

  return {
    key: `db-${child.id}`,
    ts_ms: new Date(child.timestamp).getTime(),
    text: child.description,
    severity,
  };
}
