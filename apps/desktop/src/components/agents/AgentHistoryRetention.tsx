import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import type { AgentSession } from '@runhq/cockpit-types';
import { agentWorkspaceIpc } from '@/lib/ipc/agentWorkspaceIpc';
import { useAgentStore } from '@/store/useAgentStore';

export function AgentHistoryRetention({ projectId }: { projectId: string }) {
  i18n.useLocale();
  const [days, setDays] = useState(90);
  const [preview, setPreview] = useState<AgentSession[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const button =
    'border-border rounded-md border px-3 py-1.5 text-[11px] hover:bg-fg/5 disabled:opacity-40';
  return (
    <details className="border-border text-fg-muted mb-4 rounded-lg border p-3 text-[12px]">
      <summary className="cursor-pointer">{i18n.t('History retention')}</summary>
      <p className="text-fg-dim my-3 text-[11px]">
        {i18n.t(
          'Review archived conversations before removing them. Workflow evidence and sources of project decisions are protected. Export a backup above to keep a copy. Project files, worktrees and provider history are retained.',
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label>
          {i18n.rich('Archived and unchanged for {value1}', {
            value1: (
              <SearchableSelect
                label={i18n.t('Archived history retention period')}
                searchable={false}
                compact
                className="mx-1 w-28"
                menuWidth={160}
                value={String(days)}
                disabled={busy}
                options={[30, 90, 180, 365].map((value) => ({
                  value: String(value),
                  label: i18n.t('{value} days', { value: value }),
                }))}
                onChange={(value) => {
                  setDays(Number(value));
                  setPreview(null);
                  setSelected(new Set());
                }}
              />
            ),
          })}
        </label>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            setMessage('');
            void agentWorkspaceIpc
              .retentionPreview(projectId, Date.now() - days * 86400000)
              .then((rows) => {
                setPreview(rows);
                setSelected(new Set());
              })
              .catch((e) => setError(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          {i18n.t('Preview eligible history')}
        </button>
      </div>
      {preview && (
        <div className="mt-3 space-y-2">
          <p>
            {i18n.rich('{value1} eligible conversations. Select the records to remove.', {
              value1: preview.length,
            })}
          </p>
          <div className="max-h-56 space-y-1 overflow-auto">
            {preview.map((session) => (
              <label key={session.id} className="hover:bg-fg/5 flex items-center gap-2 rounded p-1">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.has(session.id)}
                  onChange={(event) =>
                    setSelected((old) => {
                      const next = new Set(old);
                      if (event.target.checked) next.add(session.id);
                      else next.delete(session.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate">
                  {session.title} · {session.project_name}
                </span>
                <span className="text-fg-dim text-[10px]">
                  {new Date(session.updated_at).toLocaleDateString(i18n.getFormatLocale())}
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className={`${button} text-status-error`}
            disabled={busy || !selected.size}
            onClick={() => {
              setBusy(true);
              setError('');
              setMessage('');
              void (async () => {
                let removed = 0;
                const failures: string[] = [];
                const deleted = new Set<string>();
                for (const session of preview.filter((row) => selected.has(row.id))) {
                  try {
                    await agentWorkspaceIpc.retentionRemove(session.id, session.revision);
                    useAgentStore.getState().remove(session.id);
                    deleted.add(session.id);
                    removed++;
                  } catch (e) {
                    failures.push(`${session.title}: ${String(e)}`);
                  }
                }
                setPreview((rows) => rows?.filter((row) => !deleted.has(row.id)) || []);
                setSelected(new Set());
                setMessage(
                  i18n.t('Removed {removed} archived conversations.', { removed: removed }),
                );
                setError(failures.join('\n'));
                setBusy(false);
              })();
            }}
          >
            {i18n.rich('Permanently remove {value1} conversations', {
              value1: selected.size || i18n.t('selected'),
            })}
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="mt-2">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-status-error mt-2 whitespace-pre-wrap">
          {error}
        </p>
      )}
    </details>
  );
}
