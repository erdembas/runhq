import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import { Select } from '@/components/ui/Select';
import { useAiCliProject } from '@/components/ai/chat-panel/useAiCliProject';
import { AiProviderControls } from '@/components/ai/AiProviderControls';
import { changeAiGenerationSettings, type AiGenerationChange } from '@/lib/ai/aiGenerationSettings';
import {
  canUseChatProvider,
  isCliChatProvider,
  type AiChatProvider,
} from '@/components/ai/chat-panel/aiChatProviders';
import {
  aiPreferencesEvent,
  aiPreferencesKey,
  aiUseCases,
  readAiPreferences,
  saveAiSelection,
  type AiSelection,
  type AiUseCase,
} from '@/lib/ai/aiPreferences';

function useCaseLabel(useCase: AiUseCase) {
  switch (useCase) {
    case 'default':
      return i18n.t('AI default');
    case 'free':
      return i18n.t('Chat');
    case 'commit':
      return i18n.t('Commit messages');
    case 'diff':
      return i18n.t('Diff explanations');
    case 'log':
      return i18n.t('Log explanations');
    case 'standup':
      return i18n.t('Standup summaries');
    case 'why':
      return i18n.t('Project diagnostics');
    case 'dashboard_report':
      return i18n.t('Workspace analysis');
    case 'advisory':
      return i18n.t('Security advisories');
    case 'license':
      return i18n.t('License analysis');
  }
}

export function AiUseCaseSettings({ providers }: { providers: AiChatProvider[] }) {
  i18n.useLocale();
  const [preferences, setPreferences] = useState(readAiPreferences);
  const [error, setError] = useState<string | null>(null);
  const { projectControl, catalogProjectId } = useAiCliProject(true, null, setError, 'catalog');
  useEffect(() => {
    const refresh = () => setPreferences(readAiPreferences());
    const storage = (event: StorageEvent) => {
      if (event.key === aiPreferencesKey || event.key === null) refresh();
    };
    window.addEventListener(aiPreferencesEvent, refresh);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(aiPreferencesEvent, refresh);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const save = (useCase: AiUseCase, selection: AiSelection | null) => {
    try {
      saveAiSelection(useCase, selection);
      setError(null);
    } catch {
      setError(i18n.t('Could not save AI preferences.'));
    }
  };
  return (
    <section className="border-border rounded-lg border">
      <div className="border-border border-b p-4">
        <h3 className="text-fg text-[13px] font-semibold">{i18n.t('Use cases')}</h3>
        <p className="text-fg-dim mt-1 text-[11.5px]">
          {i18n.t(
            'Choose a default, then override it for individual tasks. Changes are saved automatically and apply to new requests.',
          )}
        </p>
      </div>
      <div className="border-border border-b px-4 py-3">
        <p className="text-fg-dim mb-2 text-[11px]">
          {i18n.t(
            'Use the same model, reasoning effort, mode and profile controls as a new agent conversation. Options come from the selected provider.',
          )}
        </p>
        {projectControl}
        <p className="text-fg-dim text-[10px]">
          {i18n.t(
            'The project is used to discover provider options. Each request still uses its own project context.',
          )}
        </p>
      </div>
      <div className="divide-border divide-y px-4">
        {aiUseCases.map((useCase) => (
          <UseCaseRow
            key={useCase}
            useCase={useCase}
            selection={preferences[useCase]}
            providers={providers}
            projectId={catalogProjectId}
            onChange={(selection) => save(useCase, selection)}
            onOptionsChange={(change) => {
              const current = readAiPreferences()[useCase];
              if (!current) return;
              const provider = providers.find((entry) => entry.id === current.providerId);
              save(
                useCase,
                changeAiGenerationSettings(
                  current,
                  change,
                  provider && isCliChatProvider(provider)
                    ? (provider.cli.adapter ?? provider.cli.id)
                    : undefined,
                ),
              );
            }}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="px-4 pb-3 text-[11px] text-rose-400">
          {error}
        </p>
      )}
    </section>
  );
}

function UseCaseRow({
  useCase,
  selection,
  providers,
  projectId,
  onChange,
  onOptionsChange,
}: {
  useCase: AiUseCase;
  selection?: AiSelection;
  providers: AiChatProvider[];
  projectId: string;
  onChange: (selection: AiSelection | null) => void;
  onOptionsChange: (change: AiGenerationChange) => void;
}) {
  i18n.useLocale();
  const label = useCaseLabel(useCase);
  const provider = providers.find((entry) => entry.id === selection?.providerId);
  const options = [
    {
      value: '',
      label: useCase === 'default' ? i18n.t('Ask when needed') : i18n.t('Use AI default'),
    },
    ...providers.map((entry) => ({
      value: entry.id,
      label: entry.name,
      description: isCliChatProvider(entry)
        ? i18n.t('CLI agents')
        : i18n.t('OpenAI-compatible providers'),
      disabled: !canUseChatProvider(entry),
    })),
  ];
  if (selection && !provider)
    options.push({ value: selection.providerId, label: i18n.t('Configured provider unavailable') });
  return (
    <div className="grid grid-cols-1 items-center gap-2 py-3 lg:grid-cols-[minmax(150px,1fr)_minmax(170px,2fr)]">
      <span className="text-fg/85 text-[12px] font-medium">{label}</span>
      <Select
        ariaLabel={i18n.t('Provider for {useCase}', { useCase: label })}
        value={selection?.providerId ?? ''}
        options={options}
        onChange={(providerId) => onChange(providerId ? { providerId, model: '' } : null)}
      />
      <div className="min-w-0 lg:col-span-2">
        {provider && selection && (
          <AiProviderControls
            provider={{ ...provider, ...selection, model: selection.model }}
            projectId={projectId}
            defaultModel={provider.model}
            label={i18n.t('Provider options for {useCase}', { useCase: label })}
            onChange={onOptionsChange}
            disabled={!canUseChatProvider(provider)}
          />
        )}
        {selection && (!provider || !canUseChatProvider(provider)) && (
          <p role="status" className="mt-1 text-[10px] text-amber-400">
            {i18n.t('Configured provider unavailable')}
          </p>
        )}
      </div>
    </div>
  );
}
