import { sanitizeAnsi } from '@/lib/ansi';
import type { LogLine } from '@/types';

export const FONT_STACK =
  '"JetBrains Mono", "SF Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace';

const STREAM_PREFIX: Record<LogLine['stream'], { open: string; close: string }> = {
  stdout: { open: '', close: '' },
  stderr: { open: '\x1b[31m', close: '\x1b[39m' },
  system: { open: '\x1b[36;3m', close: '\x1b[23;39m' },
};

const TS_WIDTH = 19;

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

export function formatLineBytes(line: LogLine, opts: { showTimestamp: boolean }): string {
  const sanitized = sanitizeAnsi(line.text);
  const hasInlineAnsi = sanitized.includes('\x1b[');
  let body = sanitized;
  if (!hasInlineAnsi) {
    const { open, close } = STREAM_PREFIX[line.stream];
    if (open) body = `${open}${body}${close}`;
  }
  if (opts.showTimestamp) {
    const ts = line.text.trim() === '' ? ' '.repeat(TS_WIDTH) : formatTs(line.ts_ms);
    body = `\x1b[2m${ts}\x1b[22m  ${body}`;
  }
  return `${body}\r\n`;
}
