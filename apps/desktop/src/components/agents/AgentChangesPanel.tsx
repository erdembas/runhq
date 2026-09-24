import { WorkspaceTaskSummary } from '@/components/workspaces/WorkspaceTaskSummary';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentSession, AgentItem } from '@runhq/cockpit-types';
import { FileDiff, FolderTree, List, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { BinaryPreview } from '@/components/git/shared/BinaryPreview';
import { cn } from '@/lib/cn';
import { isBinaryDiff, statusColor, statusLabel } from '@/lib/gitDiff';
import { ipc } from '@/lib/ipc';
import { usePersistentBoolean } from '@/lib/usePersistentBoolean';
import { agentChangeLines, parseAgentChanges } from './agentChanges';
import { AgentChangesFileNav } from './AgentChangesFileNav';
import { AgentChangesSurface } from './AgentChangesSurface';

const activeStatuses = new Set([
  'starting',
  'running',
  'waiting_input',
  'waiting_permission',
  'cancelling',
]);

type Comparison = {
  sessionId: string;
  diff: string | null;
  error: string | null;
  loading: boolean;
};

type ChangesViewProps = {
  expanded: boolean;
  onToggleExpanded: () => void;
  fileView: 'list' | 'tree';
  onFileViewChange: (view: 'list' | 'tree') => void;
};

function ExpandChangesButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  i18n.useLocale();
  const label = expanded ? i18n.t('Restore changes view') : i18n.t('Expand changes');
  const Icon = expanded ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      data-changes-expand-toggle
      aria-label={label}
      title={label}
      aria-pressed={expanded}
      onClick={onToggle}
      className="text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:ring-accent/50 shrink-0 rounded-md p-1.5 outline-none focus-visible:ring-2"
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}

export function AgentChangesPanel({
  session,
  visible,
  items,
}: {
  session: AgentSession;
  visible: boolean;
  items?: AgentItem[];
}) {
  i18n.useLocale();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [treeView, setTreeView] = usePersistentBoolean('runhq.agents.changes.tree-view', false);
  const expanded = visible && expandedSessionId === session.id;
  const collapse = useCallback(() => setExpandedSessionId(null), []);
  useEffect(collapse, [collapse, session.id, visible]);
  const viewProps: ChangesViewProps = {
    expanded,
    onToggleExpanded: () => setExpandedSessionId(expanded ? null : session.id),
    fileView: treeView ? 'tree' : 'list',
    onFileViewChange: (view) => setTreeView(view === 'tree'),
  };
  const members = session.workspace?.members;
  const member = members?.find((entry) => entry.service_id === memberId);
  return (
    <AgentChangesSurface
      expanded={expanded}
      onCollapse={collapse}
      label={i18n.t('Changes — {title}', { title: session.title })}
    >
      {!members?.length ? (
        <AgentProjectChangesPanel session={session} visible={visible} {...viewProps} />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-border flex items-center gap-3 border-b px-4 py-2 text-[12px]">
            <label htmlFor={`workspace-changes-${session.id}`} className="text-fg-muted">
              {i18n.t('Included projects')}
            </label>
            <select
              id={`workspace-changes-${session.id}`}
              className="bg-surface text-fg min-w-0 rounded border p-1"
              value={member?.service_id ?? ''}
              onChange={(event) => setMemberId(event.target.value)}
            >
              <option value="">{i18n.t('Cross-project summary')}</option>
              {members?.map((entry) => (
                <option key={entry.service_id} value={entry.service_id}>
                  {entry.name}
                </option>
              ))}
            </select>
            {!member && (
              <div className="ml-auto">
                <ExpandChangesButton expanded={expanded} onToggle={viewProps.onToggleExpanded} />
              </div>
            )}
          </div>
          {member ? (
            <AgentProjectChangesPanel
              key={`${session.id}:${member.service_id}`}
              session={{
                ...session,
                cwd: member.path,
                base_revision: member.base_revision,
                pre_existing_paths: member.pre_existing_paths,
              }}
              visible={visible}
              memberId={member.service_id}
              {...viewProps}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <WorkspaceTaskSummary
                session={session}
                items={items}
                visible={visible}
                onProject={setMemberId}
              />
            </div>
          )}
        </div>
      )}
    </AgentChangesSurface>
  );
}

function AgentProjectChangesPanel({
  session,
  visible,
  memberId,
  expanded,
  onToggleExpanded,
  fileView,
  onFileViewChange,
}: {
  session: AgentSession;
  visible: boolean;
  memberId?: string;
} & ChangesViewProps) {
  i18n.useLocale();
  const [comparison, setComparison] = useState<Comparison>({
    sessionId: session.id,
    diff: null,
    error: null,
    loading: false,
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const request = useRef(0);
  const current = comparison.sessionId === session.id ? comparison : null;
  const files = useMemo(() => parseAgentChanges(current?.diff ?? ''), [current?.diff]);
  const selected = files.find((file) => file.path === selectedPath) ?? files[0];
  const lines = useMemo(() => agentChangeLines(selected?.patch ?? ''), [selected?.patch]);
  const loading = current?.loading ?? true;
  const invalidate = useCallback(() => {
    request.current++;
  }, []);

  const refresh = useCallback(async () => {
    const token = ++request.current;
    setComparison((previous) => ({
      sessionId: session.id,
      diff: previous.sessionId === session.id ? previous.diff : null,
      error: null,
      loading: true,
    }));
    try {
      const diff = await ipc.agentWorkspaceDiff(session.id, memberId);
      if (request.current === token) {
        setComparison({ sessionId: session.id, diff, error: null, loading: false });
      }
    } catch (error) {
      if (request.current === token) {
        // An unsuccessful refresh must never leave an earlier comparison looking current.
        setComparison({ sessionId: session.id, diff: null, error: String(error), loading: false });
      }
    }
  }, [session.id, memberId]);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      await refresh();
      if (!disposed && activeStatuses.has(session.status))
        timer = setTimeout(() => void update(), 5000);
    };
    const onFocus = () => void refresh();
    void update();
    window.addEventListener('focus', onFocus);
    return () => {
      disposed = true;
      clearTimeout(timer);
      invalidate();
      window.removeEventListener('focus', onFocus);
    };
  }, [visible, session.status, refresh, invalidate]);

  const binary = selected && isBinaryDiff(selected.patch, selected.path);
  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 flex-col" aria-busy={loading}>
      <div className="border-border text-fg-muted flex shrink-0 items-start gap-3 border-b px-4 py-3 text-[11px]">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-fg font-medium">
            {session.base_revision
              ? i18n.t('Working tree compared with task start ({revision})', {
                  revision: session.base_revision.slice(0, 7),
                })
              : i18n.t('Working tree compared with the current commit (or an empty repository)')}
          </p>
          <p>
            {session.base_revision
              ? i18n.t(
                  'Includes committed, staged, unstaged and new files across the repository. Other work in this checkout may also appear.',
                )
              : i18n.t(
                  'No starting revision was recorded. This comparison covers the entire repository; earlier commits are not included and other work may appear.',
                )}
          </p>
          {!!session.pre_existing_paths?.length && (
            <p className="text-fg-dim max-h-16 overflow-y-auto break-words">
              {i18n.t('These files already had changes when the task started: {paths}', {
                paths: session.pre_existing_paths.join(', '),
              })}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="text-fg-muted hover:bg-surface-hover hover:text-fg flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 transition disabled:opacity-50"
        >
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
          {i18n.t('Refresh')}
        </button>
        <ExpandChangesButton expanded={expanded} onToggle={onToggleExpanded} />
      </div>
      {current?.error ? (
        <div
          role="alert"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <p className="text-tone-critical-fg text-[12px]">
            {i18n.t('Could not load changes. Refresh to try again.')}
          </p>
          <pre className="text-fg-dim max-h-32 max-w-full overflow-auto text-left text-[11px] whitespace-pre-wrap">
            {current.error}
          </pre>
        </div>
      ) : current?.diff == null ? (
        <div
          role="status"
          className="text-fg-muted flex flex-1 items-center justify-center text-[12px]"
        >
          {i18n.t('Loading changes…')}
        </div>
      ) : files.length === 0 ? (
        <div className="text-fg-muted flex flex-1 flex-col items-center justify-center gap-3 p-6 text-[12px]">
          <FileDiff size={32} className="text-fg-dim" strokeWidth={1.25} />
          <p>{i18n.t('No differences in this comparison.')}</p>
        </div>
      ) : (
        <>
          <div className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
            <span className="text-fg-muted text-[11px]">
              {i18n.plural('{count} changed file', '{count} changed files', files.length)}
            </span>
            <div
              role="group"
              aria-label={i18n.t('Changed files view')}
              className="bg-surface-raised flex shrink-0 items-center gap-0.5 rounded-md p-0.5"
            >
              {(['list', 'tree'] as const).map((view) => {
                const Icon = view === 'list' ? List : FolderTree;
                const label = view === 'list' ? i18n.t('List') : i18n.t('Tree');
                return (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={fileView === view}
                    onClick={() => onFileViewChange(view)}
                    className="text-fg-muted hover:text-fg aria-pressed:bg-surface-hover aria-pressed:text-fg focus-visible:ring-accent/50 flex items-center gap-1.5 rounded px-2 py-1 text-[11px] outline-none focus-visible:ring-2"
                  >
                    <Icon size={13} aria-hidden />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col @min-[620px]:flex-row">
            <div className="border-border flex max-h-48 min-h-0 shrink-0 flex-col overflow-hidden border-b @min-[620px]:max-h-none @min-[620px]:w-64 @min-[620px]:border-r @min-[620px]:border-b-0 @min-[1000px]:w-80">
              <AgentChangesFileNav
                files={files}
                selectedPath={selected?.path}
                onSelect={setSelectedPath}
                view={fileView}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="border-border text-fg flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate" title={selected?.path}>
                  {selected?.path}
                </span>
                {selected && (
                  <span className={statusColor[selected.status]}>
                    {statusLabel[selected.status]}
                  </span>
                )}
              </div>
              {binary && selected ? (
                <BinaryPreview
                  path={selected.path}
                  status={selected.status}
                  additions={selected.additions}
                  deletions={selected.deletions}
                  cwd={null}
                />
              ) : lines.length === 0 ? (
                <pre className="text-fg-muted overflow-auto p-4 font-mono text-[12px]">
                  {selected?.patch}
                </pre>
              ) : (
                <>
                  <p className="text-fg-dim shrink-0 px-3 py-1 text-[10px]">
                    {i18n.t('Only changed sections and nearby lines are shown.')}
                  </p>
                  <div
                    role="region"
                    aria-label={i18n.t('Changes')}
                    tabIndex={0}
                    className="min-h-0 flex-1 overflow-auto"
                  >
                    <pre className="m-0 min-w-max font-mono text-[12px] leading-5">
                      {lines.map((line, index) => (
                        <span
                          key={index}
                          className={cn(
                            'block pr-4',
                            line.kind === 'added'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                              : line.kind === 'deleted'
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
                                : line.kind === 'hunk'
                                  ? 'bg-accent/10 text-accent'
                                  : 'text-fg-muted',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="text-fg-dim inline-block w-12 pr-2 text-right select-none"
                          >
                            {line.before == null
                              ? ''
                              : i18n.number(line.before, { useGrouping: false })}
                          </span>
                          <span
                            aria-hidden="true"
                            className="text-fg-dim mr-3 inline-block w-12 pr-2 text-right select-none"
                          >
                            {line.after == null
                              ? ''
                              : i18n.number(line.after, { useGrouping: false })}
                          </span>
                          {line.text}
                        </span>
                      ))}
                    </pre>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
