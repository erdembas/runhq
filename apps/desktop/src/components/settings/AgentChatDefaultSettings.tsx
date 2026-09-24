import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import { AgentModelControls, SearchableSelect, enabledAgentBackends } from '@runhq/cockpit-ui';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentDiscovery } from '@/components/agents/useAgentDiscovery';
import { useAgentCatalog } from '@/components/agents/useAgentCatalog';
import { useAiCliProject } from '@/components/ai/chat-panel/useAiCliProject';
import { changeAiGenerationSettings, type AiGenerationChange } from '@/lib/ai/aiGenerationSettings';
import {
  agentChatDefaults,
  agentChatDefaultsKey,
  type AgentChatDefaults,
} from '@/components/agents/agentChatDefaults';
import { SettingsSection } from './SettingsView';

export function AgentChatDefaultSettings() {
  i18n.useLocale();
  const records = useAgentLibraryStore((state) => state.records);
  const ready = useAgentLibraryStore((state) => state.ready);
  const loadError = useAgentLibraryStore((state) => state.error);
  const refreshPreferences = useAgentLibraryStore((state) => state.refresh);
  const save = useAgentLibraryStore((state) => state.save);
  const backends = useAgentStore((state) => state.tools);
  const discovery = useAgentDiscovery();
  const [draft, setDraft] = useState<AgentChatDefaults | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? agentChatDefaults(records[agentChatDefaultsKey]?.value);
  const tool = backends.find((entry) => entry.id === value.backend);
  const { projectControl, catalogProjectId } = useAiCliProject(
    !!value.backend,
    null,
    setError,
    'catalog',
  );
  const {
    catalog,
    loading,
    error: catalogError,
    refresh,
  } = useAgentCatalog(
    value.backend,
    value.executable,
    catalogProjectId,
    ready && tool?.enabled !== false && tool?.adapter !== 'terminal',
    undefined,
    value.model,
  );
  const disabled = !ready || saving;
  const available =
    !!tool &&
    tool.enabled !== false &&
    tool.adapter !== 'terminal' &&
    (!!value.executable.trim() || tool.available);
  const choices = enabledAgentBackends(backends).map((entry) => ({
    value: entry.id,
    label: entry.name,
  }));
  if (value.backend && !choices.some((entry) => entry.value === value.backend))
    choices.push({ value: value.backend, label: tool?.name ?? value.backend });

  useEffect(() => {
    void refreshPreferences();
  }, [refreshPreferences]);

  const edit = (change: (current: AgentChatDefaults) => AgentChatDefaults) => {
    setDraft((current) =>
      change(current ?? agentChatDefaults(records[agentChatDefaultsKey]?.value)),
    );
    setSaved(false);
    setError(null);
  };
  const changeOptions = (change: AiGenerationChange) =>
    edit((current) =>
      agentChatDefaults(changeAiGenerationSettings(current, change, tool?.adapter ?? tool?.id)),
    );

  return (
    <SettingsSection
      title={i18n.t('New agent chat defaults')}
      description={i18n.t(
        'Choose the agent and options for new agent chats in all projects. Open drafts keep their choices; task recipes use their own settings.',
      )}
    >
      <div className="space-y-4">
        <SearchableSelect
          label={i18n.t('Default agent')}
          value={value.backend}
          disabled={disabled}
          options={[{ value: '', label: i18n.t('Automatic agent selection') }, ...choices]}
          searchPlaceholder={i18n.t('Find an agent…')}
          onChange={(backend) =>
            edit((current) => agentChatDefaults({ backend, isolated: current.isolated }))
          }
        />
        {!value.backend && (
          <p className="text-fg-dim text-[12px]">
            {i18n.t('Automatic selection prefers installed Codex, then the first available agent.')}
          </p>
        )}
        {!!value.backend && (
          <div className="space-y-3">
            {projectControl}
            <p className="text-fg-dim text-[11px]">
              {i18n.t(
                'The project is used to discover provider options. Each request still uses its own project context.',
              )}
            </p>
            <div className="text-fg-muted flex flex-wrap items-center gap-1 text-xs">
              <AgentModelControls
                catalog={catalog}
                loading={loading}
                refresh={refresh}
                model={value.model}
                effort={value.effort}
                mode={value.mode}
                agent={value.agent}
                disabled={disabled || !available || !catalogProjectId}
                onModel={(value) => changeOptions({ kind: 'model', value })}
                onEffort={(value) => changeOptions({ kind: 'effort', value })}
                onMode={(value) => changeOptions({ kind: 'mode', value })}
                onAgent={(value) => changeOptions({ kind: 'agent', value })}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => changeOptions({ kind: 'reset' })}
                className="text-accent px-2 text-[11px] disabled:opacity-40"
              >
                {i18n.t('Use agent default')}
              </button>
            </div>
            {!catalogProjectId && (
              <p className="text-fg-dim text-[11px]">
                {i18n.t('Choose a project to load this provider’s models and options.')}
              </p>
            )}
            {discovery.ready && !available && (
              <p role="status" className="text-accent text-[12px]">
                {i18n.t(
                  'The default agent is unavailable. New chats keep this selection so you can reconnect it or choose another agent.',
                )}
              </p>
            )}
            {catalogError && (
              <p role="status" className="text-fg-dim text-[11px] break-words">
                {catalogError}
              </p>
            )}
            <label className="block text-[12px]">
              <span className="text-fg-muted mb-1.5 block">{i18n.t('CLI executable')}</span>
              <input
                value={value.executable}
                disabled={disabled}
                placeholder={tool?.executable || i18n.t('Detected locally')}
                onChange={(event) =>
                  edit((current) => ({
                    ...current,
                    executable: event.target.value,
                    model: '',
                    effort: '',
                    mode: 'default',
                    agent: '',
                  }))
                }
                className="border-border bg-surface-raised text-fg w-full rounded-lg border px-3 py-2 disabled:opacity-50"
              />
              <span className="text-fg-dim mt-1.5 block text-[11px]">
                {i18n.t('Leave blank to use the agent’s configured executable.')}
              </span>
            </label>
          </div>
        )}
        <label className="block text-[12px]">
          <span className="text-fg-muted mb-1.5 block">{i18n.t('Workspace')}</span>
          <select
            value={value.isolated ? 'worktree' : 'local'}
            disabled={disabled}
            onChange={(event) =>
              edit((current) => ({ ...current, isolated: event.target.value === 'worktree' }))
            }
            className="border-border bg-surface-raised text-fg rounded-lg border px-3 py-2 disabled:opacity-50"
          >
            <option value="local">{i18n.t('Local workspace')}</option>
            <option value="worktree">{i18n.t('Isolated worktree')}</option>
          </select>
        </label>
        {value.isolated && (
          <p className="text-fg-dim text-[11px]">
            {i18n.t(
              'Starts from committed HEAD. Local changes, dependencies and environment files are not copied.',
            )}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={disabled || !draft}
            className="bg-fg text-surface rounded-lg px-3 py-2 text-[12px] disabled:opacity-40"
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await save(agentChatDefaultsKey, agentChatDefaults(value));
                setDraft(null);
                setSaved(true);
              } catch {
                setError(
                  i18n.t(
                    'Chat defaults could not be saved. Your previous settings are still active.',
                  ),
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? i18n.t('Saving…') : i18n.t('Save')}
          </button>
          <button
            type="button"
            disabled={disabled}
            className="text-fg-muted text-[12px] underline disabled:opacity-40"
            onClick={() => edit(() => agentChatDefaults())}
          >
            {i18n.t('Use defaults')}
          </button>
          {saved && (
            <span role="status" className="text-fg-muted text-[12px]">
              {i18n.t('Chat defaults saved.')}
            </span>
          )}
        </div>
        {(error || (!ready && loadError)) && (
          <div role="alert" className="text-status-error text-[12px]">
            <p>{error || i18n.t('Chat defaults could not be loaded.')}</p>
            {!ready && (
              <button
                type="button"
                className="mt-1 underline"
                onClick={() => void refreshPreferences()}
              >
                {i18n.t('Retry')}
              </button>
            )}
          </div>
        )}
        {discovery.error && (
          <p role="status" className="text-fg-dim text-[11px] break-words">
            {discovery.error}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
