import { sanitizeAnsi } from '@/lib/ansi';
import type { LogLine } from '@/types';

export const FONT_STACK =
  '"MesloLGS NF", "MesloLGS Nerd Font", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "Menlo", "Monaco", "Consolas", "Courier New", monospace';

const STREAM_PREFIX: Record<LogLine['stream'], { open: string; close: string }> = {
  stdout: { open: '', close: '' },
  // Terminals do not color stderr by stream; many CLIs, including Docker
  // BuildKit, send normal progress there. Preserve only explicit ANSI color.
  stderr: { open: '', close: '' },
  system: { open: '\x1b[36;3m', close: '\x1b[23;39m' },
};

export interface LogLineFormatOptions {
  failedDockerStepIds?: ReadonlySet<string>;
  showTimestamp: boolean;
}

const TS_WIDTH = 19;
const DOCKER_ERROR_STEP_RE = /^#(\d+)\s+ERROR\b/;
const DOCKER_STEP_HEADER_RE = /^#(\d+)\s+\[[^\]]+\]\s+/;
const ERROR_DIAGNOSTIC_RE = /^(?:#\d+\s+)?(?:ERROR|FATAL|PANIC)\b/;
const NPM_ERROR_RE = /^(npm)\s+(ERR!)(.*)$/;
const NPM_ERROR_FIELD_RE = /^(\s+)(code|syscall|file|errno)(\b.*)$/;
const NPM_WARN_RE = /^(npm)\s+(WARN)(.*)$/;

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

export function collectFailedDockerStepIds(lines: LogLine[]): Set<string> {
  const failed = new Set<string>();
  for (const line of lines) {
    const match = DOCKER_ERROR_STEP_RE.exec(sanitizeAnsi(line.text));
    const step = match?.[1];
    if (step) failed.add(step);
  }
  return failed;
}

function shouldApplyErrorFallback(
  line: LogLine,
  text: string,
  opts: LogLineFormatOptions,
): boolean {
  if (line.stream !== 'stderr') return false;
  if (ERROR_DIAGNOSTIC_RE.test(text)) return true;

  const step = DOCKER_STEP_HEADER_RE.exec(text)?.[1];
  return Boolean(step && opts.failedDockerStepIds?.has(step));
}

function applyPlainTextFallback(line: LogLine, text: string, opts: LogLineFormatOptions): string {
  const npmError = NPM_ERROR_RE.exec(text);
  if (npmError) {
    const [, prefix = '', marker = '', rawDetail = ''] = npmError;
    const detail = rawDetail.replace(NPM_ERROR_FIELD_RE, '$1\x1b[95m$2\x1b[39m$3');
    return `${prefix} \x1b[91m${marker}\x1b[39m${detail}`;
  }

  const npmWarn = NPM_WARN_RE.exec(text);
  if (npmWarn) {
    const [, prefix = '', marker = '', detail = ''] = npmWarn;
    return `${prefix} \x1b[93m${marker}\x1b[39m${detail}`;
  }

  if (shouldApplyErrorFallback(line, text, opts)) {
    return `\x1b[31m${text}\x1b[39m`;
  }

  const { open, close } = STREAM_PREFIX[line.stream];
  return open ? `${open}${text}${close}` : text;
}

export function formatLineBytes(line: LogLine, opts: LogLineFormatOptions): string {
  if (line.raw) {
    return line.text;
  }

  const sanitized = sanitizeAnsi(line.text);
  const hasInlineAnsi = sanitized.includes('\x1b[');
  let body = hasInlineAnsi ? sanitized : applyPlainTextFallback(line, sanitized, opts);
  if (opts.showTimestamp) {
    const ts = line.text.trim() === '' ? ' '.repeat(TS_WIDTH) : formatTs(line.ts_ms);
    body = `\x1b[2m${ts}\x1b[22m  ${body}`;
  }
  return `${body}\r\n`;
}
