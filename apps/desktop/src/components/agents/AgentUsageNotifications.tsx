import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import type { AgentSession } from '@runhq/cockpit-types';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { agentSessionIsHistoryOnly } from './agentComposerPolicy';
import {
  agentUsagePreferences,
  evaluateAgentUsage,
  type AgentUsageAlert,
} from './agentUsagePolicy';

type Notice = AgentUsageAlert & { key: string; sessionId: string; title: string };

export function AgentUsageNotifications({
  visible = true,
  onOpenSession,
}: {
  visible?: boolean;
  onOpenSession: (id: string) => void;
}) {
  i18n.useLocale();
  const sessions = useVisibleStore(useAgentStore, (state) => state.sessions, visible);
  const saved = useVisibleStore(
    useAgentLibraryStore,
    (state) => state.records['preferences:usage'],
    visible,
  );
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const reached = useMemo(() => {
    const preferences = agentUsagePreferences(saved?.value);
    if (!preferences.notifications) return {};
    return Object.fromEntries(
      Object.values(sessions)
        .filter((session) => !session.archived && !agentSessionIsHistoryOnly(session))
        .flatMap((session) =>
          evaluateAgentUsage(session.usage, preferences.providers[session.backend]).alerts.map(
            (alert) => {
              const key = JSON.stringify([session.id, alert.metric, alert.level, alert.threshold]);
              return [
                key,
                { ...alert, key, sessionId: session.id, title: session.title } satisfies Notice,
              ];
            },
          ),
        ),
    );
  }, [sessions, saved]);
  useEffect(() => {
    // Preserve the first crossing instead of announcing every incremental token update.
    setNotices((current) => {
      const keys = Object.keys(reached);
      if (keys.length === Object.keys(current).length && keys.every((key) => current[key]))
        return current;
      return Object.fromEntries(keys.map((key) => [key, current[key] ?? reached[key]!]));
    });
    setDismissed((current) =>
      [...current].every((key) => reached[key])
        ? current
        : new Set([...current].filter((key) => reached[key])),
    );
  }, [reached]);
  const shown = Object.values(notices).filter((notice) => !dismissed.has(notice.key));
  if (!shown.length) return null;
  return (
    <div
      aria-label={i18n.t('Agent usage alerts')}
      className="border-border max-h-44 overflow-auto border-b bg-amber-400/5 px-4 py-2"
    >
      {shown.map((notice) => (
        <div
          key={notice.key}
          role="status"
          className="text-fg-muted flex items-start gap-2 py-1.5 text-[11px]"
        >
          <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div className="flex-1">
            {i18n.rich(
              '{value1}{value2}{value3} {value4} in its {value5} report reached {value6}.{value7}',
              {
                value1: (
                  <button
                    type="button"
                    className="text-fg font-medium hover:underline"
                    onClick={() => onOpenSession(notice.sessionId)}
                  >
                    {notice.title}
                  </button>
                ),
                value2: ' · ',
                value3: notice.actual.toLocaleString(i18n.getFormatLocale()),
                value4: notice.metric,
                value5: i18n.enumLabel('usageScope', notice.scope),
                value6: notice.threshold.toLocaleString(i18n.getFormatLocale()),
                value7:
                  notice.level === 'pause'
                    ? i18n.t(' Queued followups are paused until you change the usage rule.')
                    : i18n.t(' Usage warning threshold reached.'),
              },
            )}
          </div>
          <button
            type="button"
            aria-label={i18n.t('Dismiss usage alert for {value1}', { value1: notice.title })}
            className="text-fg-dim p-0.5"
            onClick={() => setDismissed((current) => new Set([...current, notice.key]))}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function AgentUsageGuardNotice({
  session,
  queued,
}: {
  session: AgentSession;
  queued: boolean;
}) {
  i18n.useLocale();
  const saved = useAgentLibraryStore((state) => state.records['preferences:usage']);
  const preferences = agentUsagePreferences(saved?.value);
  const result = evaluateAgentUsage(session.usage, preferences.providers[session.backend]);
  if (!queued || !result.pauseReason) return null;
  return (
    <p role="status" className="rounded-lg bg-amber-400/10 px-3 py-2 text-[11px] text-amber-600">
      {result.pauseReason}
    </p>
  );
}
