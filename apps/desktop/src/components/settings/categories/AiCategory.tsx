import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { RefreshCw, TerminalSquare, Wrench } from 'lucide-react';
import { AiProviderManager } from '@/components/AiProviderManager';
import { AiUseCaseSettings } from '@/components/ai-provider-manager/AiUseCaseSettings';
import { cliChatProviders } from '@/components/ai/chat-panel/aiChatProviders';
import { useAgentDiscovery } from '@/components/agents/useAgentDiscovery';
import { useAgentStore } from '@/store/useAgentStore';
import { Button } from '@/components/ui/Button';
import type { AiProvider } from '@/types';
import { SettingsPageShell } from '../SettingsView';

export function AiCategory() {
  i18n.useLocale();
  const tools = useAgentStore((state) => state.tools);
  const discovery = useAgentDiscovery();
  const [apiProviders, setApiProviders] = useState<AiProvider[]>([]);
  const cliProviders = cliChatProviders(tools);
  return (
    <SettingsPageShell>
      <div className="space-y-6">
        <p className="text-fg-dim text-[12px]">
          {i18n.t(
            'Choose CLI agents or OpenAI-compatible providers, then set a provider and model for each use case.',
          )}
        </p>
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-fg text-[13px] font-semibold">{i18n.t('CLI agents')}</h3>
              <p className="text-fg-dim mt-1 text-[11.5px]">
                {i18n.t(
                  'Use your installed agents and their existing accounts. Manage connections to add or configure a CLI.',
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={discovery.loading}
                leftIcon={
                  <RefreshCw className={`h-3.5 w-3.5 ${discovery.loading ? 'animate-spin' : ''}`} />
                }
                onClick={() => void discovery.refresh()}
              >
                {i18n.t('Re-scan')}
              </Button>
              <Button
                size="sm"
                leftIcon={<Wrench className="h-3.5 w-3.5" />}
                onClick={() => useAgentStore.setState({ toolsOpen: true })}
              >
                {i18n.t('Manage CLI tools…')}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            {cliProviders.map((provider) => (
              <div
                key={provider.id}
                className="border-border bg-surface-muted/30 flex items-center gap-3 rounded-lg border p-3"
              >
                <TerminalSquare className="text-accent h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-fg truncate text-[12px] font-medium">{provider.name}</div>
                  <div
                    className={`mt-0.5 text-[10.5px] ${provider.cli.available ? 'text-emerald-400' : 'text-fg-dim'}`}
                    title={provider.cli.error ?? undefined}
                  >
                    {provider.cli.available ? i18n.t('Available') : i18n.t('CLI not found')}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {discovery.error && (
            <p role="alert" className="mt-2 text-[11px] text-rose-400">
              {discovery.error}
            </p>
          )}
        </section>
        <AiUseCaseSettings providers={[...apiProviders, ...cliProviders]} />
        <section className="border-border border-t pt-5">
          <h3 className="text-fg mb-2 text-[13px] font-semibold">
            {i18n.t('OpenAI-compatible providers')}
          </h3>
          <AiProviderManager onProvidersChange={setApiProviders} />
        </section>
      </div>
    </SettingsPageShell>
  );
}
