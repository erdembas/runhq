'use client';

import * as i18n from '../i18n';
import { Bell, BellOff } from 'lucide-react';

export function AgentNotificationSettings({
  enabled,
  busy,
  available,
  projectName,
  projectMuted,
  error,
  onEnable,
  onDisable,
  onToggleProjectMuted,
}: {
  enabled: boolean;
  busy: boolean;
  available: boolean;
  projectName?: string;
  projectMuted: boolean;
  error: string | null;
  onEnable: () => void;
  onDisable: () => void;
  onToggleProjectMuted: () => void;
}) {
  i18n.useLocale();
  return (
    <details className="border-border border-b px-4 py-2 text-[11px]">
      <summary className="text-fg-muted flex cursor-pointer list-none items-center gap-2">
        {i18n.rich('{value1}Notifications{value2}', {
          value1: enabled ? (
            <Bell className="text-accent h-3.5 w-3.5" />
          ) : (
            <BellOff className="h-3.5 w-3.5" />
          ),
          value2: (
            <span
              className={`${error ? 'text-status-error' : 'text-fg-dim'} ml-auto`}
              title={error ?? undefined}
            >
              {error ? i18n.t('Check settings') : enabled ? i18n.t('On') : i18n.t('Off')}
            </span>
          ),
        })}
      </summary>
      <div className="mt-3 space-y-3 pb-1">
        <p className="text-fg-dim">
          {i18n.t(
            'Get updates when tasks need a decision, fail or finish. Notifications include no task, project or message content.',
          )}
        </p>
        <button
          type="button"
          disabled={busy || !available}
          onClick={enabled ? onDisable : onEnable}
          className="border-border text-fg hover:bg-fg/5 rounded-md border px-2.5 py-1.5 disabled:opacity-50"
        >
          {busy
            ? i18n.t('Checking permission…')
            : enabled
              ? i18n.t('Disable notifications')
              : i18n.t('Enable notifications')}
        </button>
        {!available && <p className="text-fg-dim">{i18n.t('Available in the desktop app.')}</p>}
        {projectName ? (
          <label className="text-fg-muted flex items-center gap-2">
            {i18n.rich('{value1}Mute notifications for {projectName}', {
              value1: (
                <input
                  type="checkbox"
                  checked={projectMuted}
                  onChange={onToggleProjectMuted}
                  className="accent-accent"
                />
              ),
              projectName: projectName,
            })}
          </label>
        ) : (
          <p className="text-fg-dim">
            {i18n.t('Choose a project above to mute its notifications.')}
          </p>
        )}
        {error && (
          <p role="alert" className="text-status-error">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
