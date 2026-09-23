import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { AgentItem } from '@runhq/cockpit-types';

/** Icon bucket for a tool row. The view maps these to glyphs; grouping and summaries count them. */
export type AgentActivityIcon =
  'read' | 'write' | 'edit' | 'run' | 'search' | 'web' | 'task' | 'think' | 'tool';

export interface AgentActivityLine {
  /** Canonical verb for the row ("Read", "Edit", "Run"). Null when the provider reported a tool
   *  RunHQ does not recognise, so the row shows the raw title instead of inventing a verb. */
  verb: string | null;
  /** What the verb acted on: a path, a command, a pattern. Empty when the provider sent no input. */
  target: string;
  icon: AgentActivityIcon;
}

interface ToolShape {
  label: string;
  icon: AgentActivityIcon;
  /** Input fields that carry the target, most specific first. */
  keys: string[];
}

const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'notebookPath'];
const READ: ToolShape = {
  get label() {
    return i18n.t('Read');
  },
  icon: 'read',
  keys: PATH_KEYS,
};
const EDIT: ToolShape = {
  get label() {
    return i18n.t('Edit');
  },
  icon: 'edit',
  keys: PATH_KEYS,
};
const WRITE: ToolShape = {
  get label() {
    return i18n.t('Write');
  },
  icon: 'write',
  keys: PATH_KEYS,
};
const RUN: ToolShape = {
  get label() {
    return i18n.t('Run');
  },
  icon: 'run',
  keys: ['command', 'cmd'],
};
const GREP: ToolShape = {
  get label() {
    return i18n.t('Search');
  },
  icon: 'search',
  keys: ['pattern', 'query', ...PATH_KEYS],
};
const FETCH: ToolShape = {
  get label() {
    return i18n.t('Fetch');
  },
  icon: 'web',
  keys: ['url'],
};
const WEB_SEARCH: ToolShape = {
  get label() {
    return i18n.t('Web search');
  },
  icon: 'web',
  keys: ['query'],
};

/** Every provider names its tools differently, so keys here are normalised (lowercase, letters and
 *  digits only): `multi_edit`, `MultiEdit` and `multiEdit` all land on `multiedit`. */
const TOOLS: Record<string, ToolShape> = {
  read: READ,
  view: READ,
  write: WRITE,
  create: WRITE,
  edit: EDIT,
  multiedit: EDIT,
  notebookedit: EDIT,
  patch: {
    get label() {
      return i18n.t('Patch');
    },
    icon: 'edit',
    keys: PATH_KEYS,
  },
  applypatch: {
    get label() {
      return i18n.t('Patch');
    },
    icon: 'edit',
    keys: PATH_KEYS,
  },
  filechange: {
    get label() {
      return i18n.t('Patch');
    },
    icon: 'edit',
    keys: PATH_KEYS,
  },
  bash: RUN,
  shell: RUN,
  bashoutput: {
    get label() {
      return i18n.t('Run');
    },
    icon: 'run',
    keys: ['command', 'cmd', 'bash_id'],
  },
  killshell: {
    get label() {
      return i18n.t('Run');
    },
    icon: 'run',
    keys: ['shell_id'],
  },
  commandexecution: RUN,
  grep: GREP,
  glob: {
    get label() {
      return i18n.t('Find');
    },
    icon: 'search',
    keys: ['pattern', 'query', ...PATH_KEYS],
  },
  list: {
    get label() {
      return i18n.t('List');
    },
    icon: 'search',
    keys: PATH_KEYS,
  },
  ls: {
    get label() {
      return i18n.t('List');
    },
    icon: 'search',
    keys: PATH_KEYS,
  },
  webfetch: FETCH,
  fetch: FETCH,
  websearch: WEB_SEARCH,
  task: {
    get label() {
      return i18n.t('Subagent');
    },
    icon: 'task',
    keys: ['description', 'prompt'],
  },
  agent: {
    get label() {
      return i18n.t('Subagent');
    },
    icon: 'task',
    keys: ['description', 'prompt'],
  },
  todowrite: {
    get label() {
      return i18n.t('Plan');
    },
    icon: 'task',
    keys: [],
  },
  todoread: {
    get label() {
      return i18n.t('Plan');
    },
    icon: 'task',
    keys: [],
  },
  exitplanmode: {
    get label() {
      return i18n.t('Plan');
    },
    icon: 'task',
    keys: [],
  },
};

/** Tool identity inferred from the input alone, for providers that title a call by its target. */
const SHAPES: { keys: string[]; when?: string[]; shape: ToolShape }[] = [
  { keys: ['command', 'cmd'], shape: RUN },
  { keys: PATH_KEYS, when: ['oldString', 'old_string', 'edits'], shape: EDIT },
  { keys: PATH_KEYS, when: ['content', 'newString', 'new_string'], shape: WRITE },
  { keys: ['pattern'], shape: GREP },
  { keys: ['url'], shape: FETCH },
  { keys: ['query'], shape: WEB_SEARCH },
  { keys: PATH_KEYS, shape: READ },
];

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Collapse a target to one line. Providers send whole heredocs as a command; a row shows the
 *  first line and marks that more follows, and the full text stays available on the row itself. */
const compact = (value: string) => {
  const lines = value.trim().split('\n');
  const first = lines[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return lines.length > 1 && first ? `${first} …` : first;
};

/** Parse the first JSON object in a transcript body. Item text is a provider payload that may have
 *  output appended after it, and long bodies are clipped from the front, so a failure is normal. */
function parseLeading(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted) {
      if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** The tool input, whether the provider sent it bare or wrapped alongside its output. */
function inputOf(text: string): Record<string, unknown> {
  const parsed = parseLeading(text);
  if (!parsed) return {};
  const inner = parsed.input;
  if (inner && typeof inner === 'object' && !Array.isArray(inner))
    return inner as Record<string, unknown>;
  return parsed;
}

const pick = (input: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return compact(value);
    if (typeof value === 'number') return String(value);
  }
  return '';
};

const has = (input: Record<string, unknown>, keys: string[]) =>
  keys.some((key) => input[key] !== undefined && input[key] !== null && input[key] !== '');

/**
 * Turn a tool or reasoning item into a verb and a target. Providers disagree about which half they
 * put in the title — Claude sends the tool name, OpenCode and Codex send the path or command — so
 * the missing half is recovered from the reported input rather than shown as a bare path.
 */
export function describeAgentActivity(
  item: Pick<AgentItem, 'kind' | 'title' | 'text'>,
): AgentActivityLine {
  const title = (item.title ?? '').trim();
  // A thought is worth a glance in the row itself; its first line says what the agent is weighing.
  if (item.kind === 'reasoning')
    return { verb: i18n.t('Reasoning'), target: compact(item.text ?? ''), icon: 'think' };
  const input = inputOf(item.text ?? '');
  const named = TOOLS[normalize(title)];
  if (named) return { verb: named.label, target: pick(input, named.keys), icon: named.icon };
  if (title.startsWith('mcp__')) {
    const parts = title.split('__').filter(Boolean);
    return {
      verb: parts.at(-1)?.replace(/[_-]+/g, ' ') || i18n.t('Tool'),
      target: (parts.length > 2 ? parts[1] : '') ?? '',
      icon: 'tool',
    };
  }
  for (const candidate of SHAPES) {
    if (!has(input, candidate.keys)) continue;
    if (candidate.when && !has(input, candidate.when)) continue;
    return {
      verb: candidate.shape.label,
      target: pick(input, candidate.shape.keys) || compact(title),
      icon: candidate.shape.icon,
    };
  }
  return { verb: null, target: compact(title), icon: 'tool' };
}

/** Rows RunHQ folds into an activity block. Everything else keeps its own place in the transcript. */
export const isAgentActivityItem = (item: Pick<AgentItem, 'kind'>) =>
  item.kind === 'tool' || item.kind === 'reasoning';

export interface AgentActivityGroup {
  kind: 'activity';
  id: string;
  items: AgentItem[];
  /** Any step still in flight: the block stays open so the user watches work as it happens. */
  running: boolean;
  failed: number;
}

export type AgentTranscriptGroup = { kind: 'item'; item: AgentItem } | AgentActivityGroup;

/** Fold runs of tool and reasoning rows together so a turn reads as prose with its work attached,
 *  instead of as a wall of equally loud checkmarks. */
export function groupAgentTranscript(items: AgentItem[]): AgentTranscriptGroup[] {
  const groups: AgentTranscriptGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (!isAgentActivityItem(item)) {
      groups.push({ kind: 'item', item });
      continue;
    }
    const group: AgentActivityGroup =
      last?.kind === 'activity'
        ? last
        : { kind: 'activity', id: `activity-${item.id}`, items: [], running: false, failed: 0 };
    if (group.items.length === 0) groups.push(group);
    group.items.push(item);
    if (item.status === 'running') group.running = true;
    if (item.status === 'failed') group.failed += 1;
  }
  return groups;
}

const basename = (target: string) => {
  const path = target.split(/\s/)[0] ?? target;
  return path.split('/').filter(Boolean).at(-1) || target;
};

/** How a bucket reads in a summary. A single file is worth naming; more than one is a count. */
const BUCKETS: [AgentActivityIcon, (count: number, name: string) => string][] = [
  [
    'write',
    (n, name) =>
      n === 1 && name
        ? i18n.t('Created {name}', { name: name })
        : i18n.plural('Created {count} file', 'Created {count} files', n),
  ],
  [
    'edit',
    (n, name) =>
      n === 1 && name
        ? i18n.t('Edited {name}', { name: name })
        : i18n.plural('Edited {count} file', 'Edited {count} files', n),
  ],
  ['run', (n) => i18n.plural('Ran {count} command', 'Ran {count} commands', n)],
  [
    'read',
    (n, name) =>
      n === 1 && name
        ? i18n.t('Read {name}', { name: name })
        : i18n.plural('Read {count} file', 'Read {count} files', n),
  ],
  ['search', (n) => i18n.plural('Ran {count} search', 'Ran {count} searches', n)],
  ['web', (n) => i18n.plural('Made {count} web request', 'Made {count} web requests', n)],
  ['task', (n) => i18n.plural('Ran {count} subagent', 'Ran {count} subagents', n)],
  ['tool', (n) => i18n.plural('Made {count} tool call', 'Made {count} tool calls', n)],
  ['think', () => i18n.t('Thought it through')],
];
/** Buckets that describe a change to the project; they lead a summary when they are present. */
const PRIMARY: AgentActivityIcon[] = ['write', 'edit', 'run'];
const lower = (phrase: string) => phrase.charAt(0).toLowerCase() + phrase.slice(1);

/**
 * One line describing a collapsed block, in the order the work happened: what changed leads, and
 * at most two phrases survive so the line stays readable next to the agent's own prose.
 */
export function summarizeAgentActivity(items: AgentItem[]): string {
  const seen: AgentActivityIcon[] = [];
  const counts = new Map<AgentActivityIcon, number>();
  const names = new Map<AgentActivityIcon, string>();
  let failed = 0;
  for (const item of items) {
    const line = describeAgentActivity(item);
    if (!counts.has(line.icon)) seen.push(line.icon);
    counts.set(line.icon, (counts.get(line.icon) ?? 0) + 1);
    if (line.target && !names.has(line.icon)) names.set(line.icon, basename(line.target));
    if (item.status === 'failed') failed += 1;
  }
  // What changed leads, plain work follows, and a thought is only worth saying when nothing else is.
  const ordered = [
    ...seen.filter((icon) => PRIMARY.includes(icon)),
    ...seen.filter((icon) => !PRIMARY.includes(icon) && icon !== 'think'),
    ...seen.filter((icon) => icon === 'think'),
  ];
  const parts = ordered
    .slice(0, 2)
    .map((icon) => {
      const phrase = BUCKETS.find(([bucket]) => bucket === icon)?.[1];
      return phrase ? phrase(counts.get(icon) ?? 0, names.get(icon) ?? '') : '';
    })
    .filter(Boolean);
  if (failed) parts.push(i18n.t('{failed} failed', { failed: failed }));
  return parts.map((part, index) => (index === 0 ? part : lower(part))).join(', ');
}

export interface AgentActivityChange {
  added: number;
  removed: number;
}

const lines = (value: unknown): string[] => {
  if (typeof value !== 'string' || !value) return [];
  const split = value.split('\n');
  if (split.at(-1) === '') split.pop();
  return split;
};

const text = (input: Record<string, unknown>, keys: string[]): unknown =>
  keys.map((key) => input[key]).find((value) => typeof value === 'string' && value !== '');

/** Count one unified-diff body, ignoring its file headers. */
function countPatch(patch: string): AgentActivityChange {
  let added = 0;
  let removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

/**
 * Lines this step asked to add and remove, read from the instruction the agent sent its tool. It is
 * the intent of one step, not a Git diff of the tree — Changes remains the record of what landed.
 */
export function agentActivityChange(
  item: Pick<AgentItem, 'kind' | 'title' | 'text'>,
): AgentActivityChange | null {
  if (item.kind !== 'tool') return null;
  const input = inputOf(item.text ?? '');
  const patch = text(input, ['patch', 'diff']);
  if (typeof patch === 'string') {
    const counted = countPatch(patch);
    return counted.added || counted.removed ? counted : null;
  }
  const edits = Array.isArray(input.edits) ? input.edits : [input];
  let added = 0;
  let removed = 0;
  for (const raw of edits) {
    if (!raw || typeof raw !== 'object') continue;
    const edit = raw as Record<string, unknown>;
    added += lines(text(edit, ['content', 'newString', 'new_string'])).length;
    removed += lines(text(edit, ['oldString', 'old_string'])).length;
  }
  return added || removed ? { added, removed } : null;
}

/** Totals for a folded block, so a collapsed line still says how much of the project moved. */
export function sumAgentActivityChange(items: AgentItem[]): AgentActivityChange | null {
  let added = 0;
  let removed = 0;
  for (const item of items) {
    const change = agentActivityChange(item);
    added += change?.added ?? 0;
    removed += change?.removed ?? 0;
  }
  return added || removed ? { added, removed } : null;
}

export interface AgentActivityDiffLine {
  sign: '+' | '-' | ' ';
  text: string;
}
export interface AgentActivityDiff {
  lines: AgentActivityDiffLine[];
  /** True when the body was longer than a row should show; the full text stays in the payload. */
  truncated: boolean;
}

const DIFF_LIMIT = 200;

/** Every line a step asked to change, uncapped; the row and the modal slice it differently. */
function diffBody(item: Pick<AgentItem, 'kind' | 'text'>): AgentActivityDiffLine[] {
  if (item.kind !== 'tool') return [];
  const input = inputOf(item.text ?? '');
  const body: AgentActivityDiffLine[] = [];
  const patch = text(input, ['patch', 'diff']);
  if (typeof patch === 'string') {
    for (const line of patch.split('\n'))
      body.push({
        sign: line.startsWith('+++') || line.startsWith('---') ? ' ' : signOf(line),
        text: line.replace(/^[-+ ]/, ''),
      });
    return body;
  }
  const edits = Array.isArray(input.edits) ? input.edits : [input];
  for (const raw of edits) {
    if (!raw || typeof raw !== 'object') continue;
    const edit = raw as Record<string, unknown>;
    for (const line of lines(text(edit, ['oldString', 'old_string'])))
      body.push({ sign: '-', text: line });
    for (const line of lines(text(edit, ['content', 'newString', 'new_string'])))
      body.push({ sign: '+', text: line });
  }
  return body;
}

/**
 * The change a step asked for, as diff lines. A write shows its new content, an edit shows the text
 * it replaced against the text it wrote, and a patch keeps the provider's own hunks.
 */
export function agentActivityDiff(
  item: Pick<AgentItem, 'kind' | 'title' | 'text'>,
): AgentActivityDiff | null {
  const body = diffBody(item);
  if (!body.some((line) => line.sign !== ' ')) return null;
  return { lines: body.slice(0, DIFF_LIMIT), truncated: body.length > DIFF_LIMIT };
}

/**
 * The same change as a unified diff, for the full-screen viewer. Line numbers are omitted because
 * a step reports the text it replaced, not where in the file it sat; the viewer needs only the two
 * sides, and the shared parser reads a hunk without them.
 */
export function agentActivityPatch(
  item: Pick<AgentItem, 'kind' | 'title' | 'text'>,
  path = 'file',
): string | null {
  const body = diffBody(item);
  if (!body.some((line) => line.sign !== ' ')) return null;
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@',
    ...body.map((line) => `${line.sign}${line.text}`),
  ].join('\n');
}

/** A step reports absolute paths; the viewer reads better with the task's own working directory
 *  stripped off, and leaves anything outside it untouched. */
export function agentActivityRelativePath(target: string, cwd?: string | null): string {
  if (!cwd) return target;
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return target.startsWith(root) ? target.slice(root.length) : target;
}

function signOf(line: string): '+' | '-' | ' ' {
  if (line.startsWith('+')) return '+';
  if (line.startsWith('-')) return '-';
  return ' ';
}
