import type { FileDiff } from '@runhq/cockpit-types';

export type AgentChangedFile = FileDiff & { patch: string; section: 'agent' };

export interface AgentChangeLine {
  text: string;
  kind: 'hunk' | 'context' | 'added' | 'deleted' | 'metadata';
  before?: number;
  after?: number;
}

/** Preserve hunk boundaries and actual file positions instead of concatenating distant edits. */
export function agentChangeLines(patch: string): AgentChangeLine[] {
  let before = 0;
  let after = 0;
  let inHunk = false;
  const rows: AgentChangeLine[] = [];
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const text of lines) {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      inHunk = true;
      rows.push({ text, kind: 'hunk' });
    } else if (inHunk && text.startsWith('+')) {
      rows.push({ text, kind: 'added', after: after++ });
    } else if (inHunk && text.startsWith('-')) {
      rows.push({ text, kind: 'deleted', before: before++ });
    } else if (inHunk && text.startsWith(' ')) {
      rows.push({ text, kind: 'context', before: before++, after: after++ });
    } else if (inHunk) rows.push({ text, kind: 'metadata' });
  }
  return rows;
}

/** Git quotes tabs, newlines and (by default) non-ASCII UTF-8 bytes using C escapes. */
function decodePath(value: string): string {
  if (!value.startsWith('"')) return value;
  const quoted = value.match(/^"((?:\\.|[^"\\])*)"/);
  if (!quoted) return value;
  const bytes: number[] = [];
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    '\\': 92,
  };
  const encoder = new TextEncoder();
  for (const token of quoted[1]!.match(/\\[0-7]{1,3}|\\.|[^\\]+/g) ?? []) {
    if (/^\\[0-7]/.test(token)) bytes.push(parseInt(token.slice(1), 8));
    else if (token.startsWith('\\')) bytes.push(escapes[token[1]!] ?? token.charCodeAt(1));
    else bytes.push(...encoder.encode(token));
  }
  return new globalThis.TextDecoder().decode(new Uint8Array(bytes));
}

function patchPath(value: string): string {
  return decodePath(value.startsWith('"') ? value : value.replace(/\t.*$/, '')).replace(
    /^[ab]\//,
    '',
  );
}

function headerPath(header: string): string {
  const value = header.slice('diff --git '.length);
  const quotedFirst = value.match(/^"(?:\\.|[^"\\])*" (.+)$/);
  if (quotedFirst) return patchPath(quotedFirst[1]!);
  const quotedSecond = value.lastIndexOf(' "');
  if (quotedSecond >= 0) return patchPath(value.slice(quotedSecond + 1));
  // Git leaves ordinary spaces unquoted. Equal source/destination paths cover binary and
  // mode-only changes without confusing a directory whose name itself contains " b/".
  const equalPaths = value.match(/^a\/(.*) b\/\1$/);
  if (equalPaths) return equalPaths[1]!;
  const separator = value.lastIndexOf(' b/');
  return separator >= 0 ? patchPath(value.slice(separator + 1)) : patchPath(value);
}

/** Keep each raw patch intact for the shared diff reader; inspect only Git's metadata. */
export function parseAgentChanges(diff: string): AgentChangedFile[] {
  const starts = [...diff.matchAll(/^diff --git /gm)].map((match) => match.index!);
  return starts.map((start, index) => {
    const patch = diff.slice(start, starts[index + 1] ?? diff.length);
    const lines = patch.split('\n');
    let path = headerPath(lines[0]!);
    let status: FileDiff['status'] = 'modified';
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of lines.slice(1)) {
      if (line.startsWith('@@')) {
        inHunk = true;
      } else if (inHunk) {
        if (line.startsWith('+')) additions++;
        else if (line.startsWith('-')) deletions++;
      } else if (line.startsWith('new file mode ')) status = 'added';
      else if (line.startsWith('deleted file mode ')) status = 'deleted';
      else if (line.startsWith('rename to ')) {
        status = 'renamed';
        path = decodePath(line.slice('rename to '.length));
      } else if (line.startsWith('copy to ')) {
        status = 'copied';
        path = decodePath(line.slice('copy to '.length));
      } else if (line.startsWith('--- ') && line !== '--- /dev/null') {
        path = patchPath(line.slice(4));
      } else if (line.startsWith('+++ ') && line !== '+++ /dev/null') {
        path = patchPath(line.slice(4));
      }
    }
    return { path, status, additions, deletions, patch, section: 'agent' };
  });
}
