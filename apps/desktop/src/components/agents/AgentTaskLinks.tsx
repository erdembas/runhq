import * as i18n from '@runhq/cockpit-ui/i18n';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentStore } from '@/store/useAgentStore';

export function AgentTaskLinks({ sessionId }: { sessionId: string }) {
  i18n.useLocale();
  const records = useAgentLibraryStore((state) => state.records);
  const sessions = useAgentStore((state) => state.sessions);
  const related = Object.values(records)
    .filter((record) => record.key.startsWith('link:'))
    .flatMap((record) => {
      const value = record.value as {
        sourceSessionId?: string;
        targetSessionId?: string;
        kind?: string;
      } | null;
      if (!value || value.kind !== 'handoff') return [];
      const parent = value.targetSessionId === sessionId;
      const id = parent
        ? value.sourceSessionId
        : value.sourceSessionId === sessionId
          ? value.targetSessionId
          : undefined;
      return id && sessions[id] ? [{ id, parent, session: sessions[id] }] : [];
    });
  if (!related.length) return null;
  return (
    <nav
      aria-label={i18n.t('Related agent tasks')}
      className="border-border text-fg-dim flex flex-wrap gap-3 border-b px-5 py-2 text-[11px]"
    >
      {related.map(({ id, parent, session }) => (
        <button
          key={id}
          className="hover:text-fg max-w-80 min-w-0 truncate text-left"
          title={`${session.title}\n${session.cwd}`}
          onClick={() => useAgentStore.getState().select(id)}
        >
          {parent ? i18n.t('Handed off from') : i18n.t('Continued by')}{' '}
          <span className="text-accent">{session.title}</span> ·{' '}
          {session.backend_name || session.backend}
        </button>
      ))}
    </nav>
  );
}
