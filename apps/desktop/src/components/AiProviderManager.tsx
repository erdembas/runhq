import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Sparkles } from 'lucide-react';
import { AiProviderEmptyState } from '@/components/ai-provider-manager/AiProviderEmptyState';
import { AiProviderForm } from '@/components/ai-provider-manager/AiProviderForm';
import { AiProviderRow } from '@/components/ai-provider-manager/AiProviderRow';
import { EMPTY_FORM, type FormState } from '@/components/ai-provider-manager/types';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ipc } from '@/lib/ipc';
import type { AiProvider, AiTestResult } from '@/types';

export function AiProviderManager() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [removing, setRemoving] = useState<AiProvider | null>(null);
  const [testResults, setTestResults] = useState<Record<string, AiTestResult & { busy?: boolean }>>(
    {},
  );

  const reload = useCallback(async () => {
    try {
      setProviders(await ipc.listAiProviders());
    } catch (error) {
      console.error('list_ai_providers failed', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startNew = () => {
    setEditing({ ...EMPTY_FORM, default: providers.length === 0 });
  };

  const startEdit = (provider: AiProvider) => {
    setEditing({
      id: provider.id,
      name: provider.name,
      base_url: provider.base_url,
      api_key: provider.api_key,
      model: provider.model,
      default: provider.default,
      response_language: provider.response_language ?? 'auto',
      commit_language: provider.commit_language ?? 'inherit',
      max_output_tokens:
        provider.max_output_tokens != null && provider.max_output_tokens > 0
          ? String(provider.max_output_tokens)
          : '',
      context_window:
        provider.context_window != null && provider.context_window > 0
          ? String(provider.context_window)
          : '',
    });
  };

  const handleSetDefault = async (provider: AiProvider) => {
    if (provider.default) return;
    try {
      await ipc.setDefaultAiProvider(provider.id);
      await reload();
    } catch (error) {
      console.error('set_default_ai_provider failed', error);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    try {
      await ipc.removeAiProvider(removing.id);
      setRemoving(null);
      await reload();
    } catch (error) {
      console.error('remove_ai_provider failed', error);
    }
  };

  const handleTest = async (provider: AiProvider) => {
    setTestResults((prev) => ({
      ...prev,
      [provider.id]: { ok: false, latency_ms: 0, busy: true },
    }));

    try {
      const result = await ipc.testAiProvider(provider.id);
      setTestResults((prev) => ({ ...prev, [provider.id]: { ...result, busy: false } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: { ok: false, latency_ms: 0, message, busy: false },
      }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <AiProviderForm
          state={editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-fg-dim text-[11.5px] leading-snug">
              RunHQ talks to any service that speaks the OpenAI Chat Completions API — cloud
              gateways (OpenAI, OpenRouter, Groq, …) or a local server on{' '}
              <span className="text-fg/80 font-mono text-[10.5px]">localhost</span> (Ollama, LM
              Studio). Add one or more, mark a default, and the AI surfaces will use it.
            </p>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={startNew}
            >
              Add Provider
            </Button>
          </div>

          {loading && (
            <div className="text-fg-dim flex items-center gap-2 py-6 text-[12px]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading providers…
            </div>
          )}

          {!loading && providers.length === 0 && <AiProviderEmptyState onAdd={startNew} />}

          {!loading && providers.length > 0 && (
            <ul className="flex flex-col gap-2">
              {providers.map((provider) => (
                <AiProviderRow
                  key={provider.id}
                  provider={provider}
                  test={testResults[provider.id]}
                  onTest={() => handleTest(provider)}
                  onEdit={() => startEdit(provider)}
                  onRemove={() => setRemoving(provider)}
                  onSetDefault={() => handleSetDefault(provider)}
                />
              ))}
            </ul>
          )}

          <div className="border-border mt-5 flex items-start gap-2 border-t pt-3">
            <Sparkles className="text-accent mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p className="text-fg-dim text-[11px] leading-snug">
              Once a provider is configured, head to the commit panel of any git-tracked service and
              click the sparkles button next to the message box to generate a commit message from
              your staged diff.
            </p>
          </div>
        </>
      )}

      {removing && (
        <ConfirmDialog
          title="Remove AI provider?"
          message={`This deletes "${removing.name}" from your config. The provider's API key on disk will be erased. This cannot be undone.`}
          tone="danger"
          confirmLabel="Remove"
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
