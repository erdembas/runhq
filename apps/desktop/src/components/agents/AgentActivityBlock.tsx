import { memo, useMemo, useState } from 'react';
import {
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  FilePen,
  FilePlus,
  FileText,
  GitBranch,
  Globe,
  Loader2,
  Maximize2,
  Search,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import type { AgentItem } from '@runhq/cockpit-types';
import {
  agentActivityChange,
  agentActivityDiff,
  agentActivityPatch,
  agentActivityRelativePath,
  describeAgentActivity,
  sumAgentActivityChange,
  summarizeAgentActivity,
  type AgentActivityGroup,
  type AgentActivityIcon,
} from './agentActivity';
import { AgentDiffModal } from './AgentDiffModal';

const ACTIVITY_ICONS: Record<AgentActivityIcon, typeof Wrench> = {
  read: FileText,
  write: FilePlus,
  edit: FilePen,
  run: TerminalSquare,
  search: Search,
  web: Globe,
  task: GitBranch,
  think: Brain,
  tool: Wrench,
};

/** Show the file a step touched, with its directory kept as quiet context rather than as noise. */
function splitTarget(target: string) {
  const cut = target.lastIndexOf('/');
  if (cut < 0 || target.includes(' ')) return { lead: '', tail: target };
  return { lead: target.slice(0, cut + 1), tail: target.slice(cut + 1) };
}

/** One step of the agent's work: what it did, to what, and its output behind a disclosure. */
const ActivityRow = memo(function ActivityRow({
  item,
  focused,
  cwd,
}: {
  item: AgentItem;
  focused: boolean;
  cwd?: string | null;
}) {
  const line = describeAgentActivity(item);
  const Icon = ACTIVITY_ICONS[line.icon];
  const running = item.status === 'running';
  const failed = item.status === 'failed';
  const verb = line.verb === 'Reasoning' && running ? 'Thinking…' : line.verb;

  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  // Payloads run to 128 KiB, so a row reads its own only once the user opens it.
  const diff = useMemo(() => (open ? agentActivityDiff(item) : null), [open, item]);
  // Absolute paths crowd the row; the task's own directory is context the user already has.
  const path = agentActivityRelativePath(line.target, cwd);
  const { lead, tail } = splitTarget(path);
  // The viewer's payload is built on demand: opening it is a click, not every render.
  const viewer = useMemo(() => {
    if (!full) return null;
    const patch = agentActivityPatch(item, path);
    return patch ? { patch, change: agentActivityChange(item) } : null;
  }, [full, item, path]);
  return (
    <details
      data-agent-item={item.id}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={`group rounded-md text-[12px] ${failed ? 'border-status-error/20 bg-status-error/5 text-status-error border' : 'text-fg-dim'} ${focused ? 'ring-accent/40 ring-1' : ''}`}
    >
      <summary className="hover:bg-fg/3 focus-visible:ring-accent/50 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 outline-none focus-visible:ring-2">
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : failed ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        )}
        {verb && <span className="text-fg-muted w-[4.5rem] shrink-0 truncate">{verb}</span>}
        <span className="min-w-0 flex-1 truncate" title={line.target || item.title}>
          <span className="opacity-60">{lead}</span>
          {tail}
        </span>
        {(line.icon === 'edit' || line.icon === 'write') && (
          <button
            type="button"
            aria-label={`Open ${path} in the full diff viewer`}
            title="Open in full diff viewer"
            // A summary click toggles the row; this control opens the viewer instead.
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setFull(true);
            }}
            className="hover:bg-fg/10 hover:text-fg flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition group-hover:opacity-70"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        )}
        <ChevronRight
          className="h-3 w-3 shrink-0 opacity-0 transition-transform group-open:rotate-90 group-open:opacity-60 group-hover:opacity-60"
          aria-hidden
        />
      </summary>
      {viewer && (
        <AgentDiffModal
          path={path}
          patch={viewer.patch}
          added={viewer.change?.added ?? 0}
          removed={viewer.change?.removed ?? 0}
          cwd={cwd}
          onClose={() => setFull(false)}
        />
      )}
      {diff ? (
        <div className="border-border mt-1 mb-1 ml-3 max-h-96 overflow-auto border-l py-1 pr-3 pl-2 font-mono text-[11px] leading-[1.5]">
          {diff.lines.map((line, index) => (
            <div
              key={index}
              className={`px-2 whitespace-pre ${
                line.sign === '+'
                  ? 'bg-emerald-400/10 text-emerald-300'
                  : line.sign === '-'
                    ? 'bg-rose-400/10 text-rose-300'
                    : 'text-fg-dim'
              }`}
            >
              <span className="opacity-50 select-none">{line.sign}</span> {line.text}
            </div>
          ))}
          {diff.truncated && <div className="text-fg-dim px-2 pt-1">… truncated</div>}
        </div>
      ) : (
        <pre className="border-border text-fg-muted mt-1 mb-1 ml-3 max-h-96 overflow-auto border-l py-2 pr-3 pl-4 break-words whitespace-pre-wrap">
          {item.text || 'Waiting for output…'}
        </pre>
      )}
    </details>
  );
});

/**
 * A run of steps folded into one line. It stays open while the agent is working, or when a step
 * failed or is being linked to, and collapses to a summary once the work is done, so a finished
 * turn reads as its answer rather than as a wall of checkmarks.
 */
export function AgentActivityBlock({
  group,
  focusItemId,
  cwd,
}: {
  group: AgentActivityGroup;
  focusItemId?: string;
  cwd?: string | null;
}) {
  const auto =
    group.running || group.failed > 0 || group.items.some((item) => item.id === focusItemId);
  const [override, setOverride] = useState<boolean | null>(null);
  const change = useMemo(() => sumAgentActivityChange(group.items), [group.items]);
  const summary = useMemo(() => summarizeAgentActivity(group.items), [group.items]);

  const rows = group.items.map((item) => (
    <ActivityRow key={item.id} item={item} focused={focusItemId === item.id} cwd={cwd} />
  ));
  if (rows.length < 2) return <>{rows}</>;
  const open = override ?? auto;
  const current = group.items.filter((item) => item.status === 'running').at(-1);
  const step = current ? describeAgentActivity(current) : null;
  const label = step
    ? [step.verb === 'Reasoning' ? 'Thinking…' : step.verb, step.target].filter(Boolean).join(' ')
    : summary;
  return (
    <details
      open={open}
      // A toggle that matches the automatic state is React opening the block, not the user; only a
      // disagreement is a choice worth keeping, so auto-collapse still happens after the turn.
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOverride(next === auto ? null : next);
      }}
      className="group/activity rounded-md"
    >
      <summary className="text-fg-dim hover:bg-fg/3 hover:text-fg-muted focus-visible:ring-accent/50 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12px] outline-none focus-visible:ring-2">
        <ChevronRight
          className="h-3 w-3 shrink-0 transition-transform group-open/activity:rotate-90"
          aria-hidden
        />
        {group.running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : group.failed ? (
          <CircleAlert className="text-status-error h-3.5 w-3.5 shrink-0" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 opacity-60" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {change && (
          <span className="shrink-0 tabular-nums">
            <span className="text-emerald-400">+{change.added}</span>{' '}
            <span className="text-rose-400">−{change.removed}</span>
          </span>
        )}
        <span className="shrink-0 tabular-nums opacity-60">{group.items.length}</span>
      </summary>
      <div className="border-border/60 mt-0.5 ml-2.5 space-y-0.5 border-l pl-2">{rows}</div>
    </details>
  );
}
