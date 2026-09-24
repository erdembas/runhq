import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import type { AgentItem, AgentSession, AgentWorkspaceMember } from '@runhq/cockpit-types';
import { RefreshCw } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { workspaceChangeTotals, workspaceCheckEvidence } from './workspaceModel';

type Result = {
  serviceId: string;
  name: string;
  totals?: ReturnType<typeof workspaceChangeTotals>;
  error?: string;
};
export function WorkspaceTaskSummary({
  session,
  visible,
  onProject,
  items,
}: {
  session: AgentSession;
  visible: boolean;
  onProject?: (serviceId: string) => void;
  items?: AgentItem[];
}) {
  i18n.useLocale();
  const [data, setData] = useState<{ id: string; results: Result[]; items: AgentItem[] } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const memberSnapshot = JSON.stringify(session.workspace?.members ?? []);
  const sessionId = session.id;
  const phase = session.status;
  const lastTurn = session.last_turn_ms;
  const hasItems = items !== undefined;
  useEffect(() => {
    const members = JSON.parse(memberSnapshot) as AgentWorkspaceMember[];
    if (!visible || !members.length) return;
    let disposed = false;
    setLoading(true);
    setHistoryError(null);
    const read = async () => {
      const results = await Promise.all(
        members.map(async (member): Promise<Result> => {
          try {
            return {
              serviceId: member.service_id,
              name: member.name,
              totals: workspaceChangeTotals(
                await ipc.agentWorkspaceDiff(sessionId, member.service_id),
              ),
            };
          } catch (reason) {
            return { serviceId: member.service_id, name: member.name, error: String(reason) };
          }
        }),
      );
      let transcript: AgentItem[] = [];
      if (!hasItems) {
        try {
          transcript = (await ipc.agentSnapshot(sessionId)).items;
        } catch (reason) {
          if (!disposed) setHistoryError(String(reason));
        }
      }
      if (!disposed) {
        setData({ id: sessionId, results, items: transcript });
        setLoading(false);
      }
    };
    void read();
    return () => {
      disposed = true;
    };
    // Status transitions refresh the final result; streaming deltas do not fan out Git reads.
  }, [sessionId, phase, lastTurn, memberSnapshot, visible, attempt, hasItems]);
  const current = data?.id === session.id ? data : null;
  const transcript = items ?? current?.items ?? [];
  const checks = workspaceCheckEvidence(transcript);
  const latest = [...transcript]
    .reverse()
    .find((item) => item.kind === 'assistant' && item.text.trim());
  return (
    <section className="border-border rounded-xl border p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-fg text-[13px] font-semibold">{i18n.t('Cross-project summary')}</h2>
        <button
          type="button"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
          className="text-fg-muted hover:text-fg flex items-center gap-1 text-[11px] disabled:opacity-40"
        >
          <RefreshCw className="h-3 w-3" />
          {i18n.t('Refresh')}
        </button>
      </div>
      <p className="text-fg-muted mb-1 text-[12px]">{session.title}</p>
      <p className="text-fg-dim mb-4 text-[11px]">
        {i18n.t('Current checkout changes compared with task start. Other work may also appear.')}
      </p>
      {loading && (
        <p role="status" className="text-fg-dim text-[12px]">
          {i18n.t('Loading project changes…')}
        </p>
      )}
      {!loading &&
        current?.results.map((result) => (
          <div
            key={result.serviceId}
            className="border-border/60 flex flex-wrap items-center gap-3 border-t py-3 text-[12px]"
          >
            <span className="text-fg min-w-0 flex-1 truncate">{result.name}</span>
            {result.totals ? (
              <>
                <span className="text-fg-muted">
                  {i18n.t('Changed files')}: {i18n.number(result.totals.files)}
                </span>
                <span className="text-status-success">+{i18n.number(result.totals.additions)}</span>
                <span className="text-status-error">−{i18n.number(result.totals.deletions)}</span>
                {onProject && (
                  <button
                    className="text-accent hover:underline"
                    onClick={() => onProject(result.serviceId)}
                  >
                    {i18n.t('View project changes')}
                  </button>
                )}
              </>
            ) : (
              <details className="text-status-error">
                <summary>{i18n.t('Could not read this project’s changes.')}</summary>
                <pre className="max-h-24 overflow-auto text-[10px] whitespace-pre-wrap">
                  {result.error}
                </pre>
              </details>
            )}
          </div>
        ))}
      {latest && (
        <details className="text-fg-muted border-border mt-3 border-t pt-3 text-[12px]">
          <summary className="cursor-pointer font-medium">{i18n.t('Latest agent result')}</summary>
          <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{latest.text}</p>
        </details>
      )}
      <details className="text-fg-muted border-border mt-3 border-t pt-3 text-[12px]">
        <summary className="cursor-pointer font-medium">{i18n.t('Agent-reported checks')}</summary>
        <p className="text-fg-dim mt-2 text-[11px]">
          {i18n.t(
            'Checks below are reported by the agent; RunHQ has not independently rerun them.',
          )}
        </p>
        {checks.length ? (
          checks.map((item) => (
            <details key={item.id} className="bg-fg/3 mt-2 rounded p-2">
              <summary className="cursor-pointer">
                {item.title} · {item.status}
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto text-[11px] whitespace-pre-wrap">
                {item.text}
              </pre>
            </details>
          ))
        ) : (
          <p className="mt-2">{i18n.t('No check results reported yet.')}</p>
        )}
        {historyError && (
          <p role="alert" className="text-status-error mt-2">
            {historyError}
          </p>
        )}
      </details>
    </section>
  );
}
