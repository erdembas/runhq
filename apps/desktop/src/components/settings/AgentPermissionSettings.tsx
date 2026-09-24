import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useId, useState } from 'react';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { SettingsSection } from './SettingsView';

export function AgentPermissionSettings() {
  i18n.useLocale();
  const id = useId();
  const records = useAgentLibraryStore((state) => state.records);
  const ready = useAgentLibraryStore((state) => state.ready);
  const error = useAgentLibraryStore((state) => state.error);
  const refresh = useAgentLibraryStore((state) => state.refresh);
  const save = useAgentLibraryStore((state) => state.save);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const stored = (records['preferences:permissions']?.value as { policy?: unknown } | undefined)
    ?.policy;
  const policy = stored === 'read' || stored === 'all' ? stored : 'ask';
  const workspaces = Object.values(records).flatMap((record) => {
    const value = record.value as { path?: unknown; policy?: unknown } | null;
    return record.key.startsWith('preferences:workspace-permissions:') &&
      value?.policy === 'all' &&
      typeof value.path === 'string'
      ? [{ key: record.key, path: value.path }]
      : [];
  });
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SettingsSection
      title={i18n.t('Agent permissions')}
      description={i18n.t(
        'Saved for all projects. Changes apply when the next agent turn starts, including follow-ups in existing tasks. Pending requests keep their current behavior.',
      )}
    >
      <select
        aria-label={i18n.t('Agent permissions')}
        aria-describedby={`${id}-description`}
        value={policy}
        disabled={!ready || saving}
        onChange={(event) => {
          const policy = event.target.value;
          setSaving(true);
          setSaveFailed(false);
          void save('preferences:permissions', { policy })
            .catch(() => setSaveFailed(true))
            .finally(() => setSaving(false));
        }}
        className="border-border bg-surface-raised text-fg rounded-app-sm max-w-full border px-3 py-2 text-sm disabled:opacity-50"
      >
        <option value="ask">{i18n.t('Always ask')}</option>
        <option value="read">{i18n.t('Automatically allow file reading and folder access')}</option>
        <option value="all">{i18n.t('Automatically allow all tool permissions')}</option>
      </select>
      <p id={`${id}-description`} className="text-fg-muted mt-2 text-[12px]">
        {policy === 'all'
          ? i18n.t(
              'Allows tool permissions including commands, file changes and network access without asking.',
            )
          : policy === 'read'
            ? i18n.t(
                'Allows recognized file reading, search and folder access requests, including OpenCode access outside the project. Other permissions still ask.',
              )
            : i18n.t('Agents will wait for your approval when a tool requests permission.')}
      </p>
      <p className="text-fg-dim mt-2 text-[11px]">
        {i18n.t(
          'Questions and forms still need your response. Plan mode and independent reviews keep manual approvals. Automatic decisions appear in the conversation.',
        )}
      </p>
      {workspaces.length > 0 && (
        <div className="border-border mt-4 border-t pt-4">
          <h3 className="text-fg text-sm font-medium">{i18n.t('Workspace permissions')}</h3>
          <p className="text-fg-muted mt-1 text-[12px]">
            {i18n.t(
              'Saved workspace permissions allow all tools for tasks started in these folders. Removing a permission applies from the next turn.',
            )}
          </p>
          <ul className="mt-2 space-y-2">
            {workspaces.map((workspace) => (
              <li key={workspace.key} className="flex items-center gap-3 text-[12px]">
                <span className="text-fg min-w-0 flex-1 break-all">{workspace.path}</span>
                <button
                  type="button"
                  disabled={saving}
                  aria-label={i18n.t('Remove permission for {workspace}', {
                    workspace: workspace.path,
                  })}
                  className="text-fg-muted hover:text-fg shrink-0 underline disabled:opacity-50"
                  onClick={() => {
                    setSaving(true);
                    setSaveFailed(false);
                    void save(workspace.key, null)
                      .catch(() => setSaveFailed(true))
                      .finally(() => setSaving(false));
                  }}
                >
                  {i18n.t('Remove')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(saveFailed || (!ready && error)) && (
        <div role="alert" className="text-status-error mt-2 text-[12px]">
          <p>
            {saveFailed
              ? i18n.t(
                  'Permission settings could not be saved. Your previous choice is still active.',
                )
              : i18n.t('Permission settings could not be loaded.')}
          </p>
          {!ready && (
            <button type="button" className="mt-1 underline" onClick={() => void refresh()}>
              {i18n.t('Retry')}
            </button>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
