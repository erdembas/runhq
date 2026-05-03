import { useEffect, useState } from 'react';
import { Bot, ExternalLink, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ipc } from '@/lib/ipc';
import type { AiProvider } from '@/types';
import { SettingsPageShell, SettingsSection } from '../SettingsView';

/**
 * AI Providers landing page inside Settings.
 *
 * The legacy `AiSettings` modal owns the provider CRUD flow
 * (create / edit / delete forms, language pickers, test button,
 * etc.) — embedding all of that here would dwarf every other
 * Settings page and force a refactor of a stable component for
 * cosmetic gain. Instead this page renders a *summary* of the
 * configured providers and a launcher button that opens the
 * existing dialog.
 *
 * The summary is read-only by design: making the user click
 * "Manage" to perform any change keeps the editing surface in one
 * predictable place. A future iteration could promote in-place
 * editing here once the AI provider component is split into
 * smaller pieces; this scaffold lets us ship the new Settings hub
 * today without blocking on that refactor.
 */
export function AiCategory({
  description,
  onOpenManager,
}: {
  description?: string;
  onOpenManager?: () => void;
}) {
  const [providers, setProviders] = useState<AiProvider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipc
      .listAiProviders()
      .then((list) => {
        if (!cancelled) setProviders(list);
      })
      .catch((err) => {
        console.error('[Settings] list_ai_providers failed', err);
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultProvider = providers?.find((p) => p.default) ?? null;

  return (
    <SettingsPageShell description={description}>
      <SettingsSection
        title="Configured providers"
        description="Each conversation routes through one provider. The default below is what new chats start with — surface-level shortcuts (commit messages, code review, log explanations) also use the default unless a project overrides it."
        trailing={
          onOpenManager && (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
              onClick={onOpenManager}
            >
              Manage providers
            </Button>
          )
        }
      >
        {providers === null ? (
          <div className="text-fg-dim py-6 text-center text-[12px]">Loading providers…</div>
        ) : providers.length === 0 ? (
          <div className="border-border/50 bg-surface/40 rounded-app-sm flex flex-col items-center gap-2 border border-dashed py-8 text-center">
            <Bot className="text-fg-dim h-6 w-6" />
            <div className="text-fg text-[12px] font-medium">No AI providers yet</div>
            <p className="text-fg-dim max-w-[320px] text-[11px]">
              Add an API key for OpenAI-compatible providers (OpenAI, Anthropic, OpenRouter, your
              local Ollama, etc.) to unlock commit messages, code review, and the AI chat panel.
            </p>
            {onOpenManager && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                onClick={onOpenManager}
                className="mt-1"
              >
                Add a provider
              </Button>
            )}
          </div>
        ) : (
          <div className="border-border/50 divide-border/40 rounded-app-sm bg-surface/40 overflow-hidden border">
            {providers.map((p) => (
              <ProviderRow key={p.id} provider={p} isDefault={p === defaultProvider} />
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Defaults & overrides"
        description="Some surfaces have their own provider override (e.g. commit-message generator can pin a faster model). Manage those inside the provider dialog when editing a provider."
      >
        <div className="border-border/50 bg-surface/40 rounded-app-sm border px-3 py-3 text-[11px] leading-relaxed">
          <div className="text-fg mb-1 font-medium">Tips</div>
          <ul className="text-fg-dim list-disc space-y-1 pl-4">
            <li>
              The provider marked as <span className="text-fg font-medium">default</span> is the
              fallback for every surface that doesn&rsquo;t pin its own model.
            </li>
            <li>
              Per-conversation provider switches in the chat composer override the default for that
              single thread only.
            </li>
            <li>
              To switch providers project-wide, edit the project&rsquo;s AI override in its service
              settings.
            </li>
          </ul>
        </div>
      </SettingsSection>
    </SettingsPageShell>
  );
}

function ProviderRow({ provider, isDefault }: { provider: AiProvider; isDefault: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-fg truncate text-[12px] font-medium">{provider.name}</span>
          {isDefault && (
            <span className="bg-accent/15 text-accent rounded-full px-1.5 py-0.5 text-[9px] font-medium tracking-wider uppercase">
              Default
            </span>
          )}
        </div>
        <div className="text-fg-dim mt-0.5 truncate font-mono text-[10.5px]">
          {provider.model} · {provider.base_url}
        </div>
      </div>
      <span className="text-fg-dim text-[10px] tracking-wider uppercase">{provider.kind}</span>
    </div>
  );
}
