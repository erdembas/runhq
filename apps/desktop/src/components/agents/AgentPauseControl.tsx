import { useRef, useState } from 'react';
import { Loader2, Pause, Play, X } from 'lucide-react';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { agentIsActive } from '@runhq/cockpit-ui';
import type { AgentSession } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';

export function AgentPauseControl({
  session,
  onError,
}: {
  session: AgentSession;
  onError: (message: string) => void;
}) {
  i18n.useLocale();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  if (!agentIsActive(session.status) || session.status === 'cancelling') return null;
  const pausing = session.pause_state === 'pausing';
  const paused = session.pause_state === 'paused';
  const available = session.pause_state != null;
  const label = pausing
    ? i18n.t('Cancel pause')
    : paused
      ? i18n.t('Resume agent')
      : i18n.t('Pause agent');
  return (
    <div className="text-fg-muted flex items-center gap-1.5 text-[11px]">
      {pausing && (
        <span
          role="status"
          className="flex items-center gap-1"
          title={i18n.t('Waiting for the current step to finish')}
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {i18n.t('Pausing…')}
        </span>
      )}
      {paused && <span role="status">{i18n.t('Paused')}</span>}
      <button
        type="button"
        aria-label={label}
        title={
          !available
            ? i18n.t('Pause becomes available when the provider exposes a supported checkpoint.')
            : pausing
              ? label
              : paused
                ? i18n.t('Continue from the paused step')
                : i18n.t('Pause after the current step finishes')
        }
        disabled={!available || busy}
        className="hover:bg-fg/5 focus-visible:ring-accent/50 flex h-8 items-center justify-center gap-1 rounded-md px-2 outline-none focus-visible:ring-2 disabled:opacity-40"
        onClick={() => {
          if (!available || inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          void ipc
            .agentPause(session.id, pausing || paused)
            .catch((error: unknown) =>
              onError(i18n.t('Could not change pause state: {error}', { error: String(error) })),
            )
            .finally(() => {
              inFlight.current = false;
              setBusy(false);
            });
        }}
      >
        {paused ? (
          <Play className="h-3.5 w-3.5" aria-hidden />
        ) : pausing ? (
          <X className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Pause className="h-3.5 w-3.5" aria-hidden />
        )}
        {paused && i18n.t('Resume')}
      </button>
    </div>
  );
}
