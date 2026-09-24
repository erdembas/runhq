import * as i18n from '@runhq/cockpit-ui/i18n';
import { AgentModelControls } from '@runhq/cockpit-ui';
import { useAgentCatalog } from '@/components/agents/useAgentCatalog';
import { defaultCliChatMode, type AiGenerationChange } from '@/lib/ai/aiGenerationSettings';
import {
  isCliChatProvider,
  type AiChatProvider,
  type CliChatProvider,
} from './chat-panel/aiChatProviders';

interface Props {
  provider: AiChatProvider;
  projectId: string;
  onChange: (change: AiGenerationChange) => void;
  disabled?: boolean;
  label?: string;
  defaultModel?: string;
}

/** Keep capability discovery and the controls identical across Chat and AI use-case settings. */
export function AiProviderControls(props: Props) {
  i18n.useLocale();
  return (
    <div
      role="group"
      aria-label={props.label ?? i18n.t('Provider options')}
      className="min-w-0 space-y-1.5"
    >
      {isCliChatProvider(props.provider) ? (
        <CliControls {...props} provider={props.provider} />
      ) : (
        <input
          aria-label={i18n.t('Model')}
          title={i18n.t('Choose a model or enter its ID. Leave blank to use the provider default.')}
          value={props.provider.model}
          placeholder={props.defaultModel || i18n.t('Provider default model')}
          disabled={props.disabled}
          onChange={(event) => props.onChange({ kind: 'model', value: event.target.value })}
          className="border-border/50 bg-surface text-fg/80 focus:border-accent/50 w-full rounded-md border px-2.5 py-1 font-mono text-[11.5px] outline-none disabled:opacity-40"
        />
      )}
    </div>
  );
}

function CliControls({
  provider,
  projectId,
  onChange,
  disabled,
}: Props & { provider: CliChatProvider }) {
  i18n.useLocale();
  const { catalog, loading, error, refresh } = useAgentCatalog(
    provider.cli.id,
    provider.cli.executable ?? '',
    projectId,
    provider.cli.available && !disabled,
    undefined,
    provider.model,
  );
  return (
    <>
      <div className="text-fg-muted flex flex-wrap items-center gap-1 text-xs">
        <AgentModelControls
          catalog={catalog}
          loading={loading}
          refresh={refresh}
          model={provider.model}
          effort={provider.effort ?? ''}
          mode={provider.mode ?? defaultCliChatMode(provider.cli)}
          agent={provider.agent ?? ''}
          disabled={disabled || !projectId || !provider.cli.available}
          onModel={(value) => onChange({ kind: 'model', value })}
          onEffort={(value) => onChange({ kind: 'effort', value })}
          onMode={(value) => onChange({ kind: 'mode', value })}
          onAgent={(value) => onChange({ kind: 'agent', value })}
        />
        {(provider.model || provider.effort || provider.mode || provider.agent) && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ kind: 'reset' })}
            className="text-accent px-2 text-[11px] disabled:opacity-40"
          >
            {i18n.t('Use defaults')}
          </button>
        )}
      </div>
      {!projectId && (
        <p className="text-fg-dim text-[11px]">
          {i18n.t('Choose a project to load this provider’s models and options.')}
        </p>
      )}
      {error && (
        <p role="status" className="text-fg-dim text-[11px] break-words">
          {error}
        </p>
      )}
    </>
  );
}
