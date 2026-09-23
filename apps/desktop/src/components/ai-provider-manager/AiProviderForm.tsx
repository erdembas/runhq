import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Sparkles, Zap } from 'lucide-react';
import { LanguagePicker } from '@/components/ai-provider-manager/LanguagePicker';
import { COMMIT_LANGUAGE_OPTIONS } from '@/components/ai-provider-manager/languageOptions';
import type { FormState } from '@/components/ai-provider-manager/types';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import type { AiTestResult } from '@/types';

interface AiProviderFormProps {
  state: FormState;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}

export function AiProviderForm({ state, onCancel, onSaved }: AiProviderFormProps) {
  i18n.useLocale();
  const [form, setForm] = useState<FormState>(state);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const isEdit = Boolean(state.id);

  const isLocalUrl = useMemo(() => {
    const url = form.base_url.trim();
    if (!url) return false;
    try {
      const host = new URL(url).hostname;
      return (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host.endsWith('.local')
      );
    } catch {
      return false;
    }
  }, [form.base_url]);

  const validate = (): string | null => {
    if (!form.name.trim()) return i18n.t('Display name is required.');
    if (!form.base_url.trim()) return i18n.t('Base URL is required.');
    try {
      new URL(form.base_url.trim());
    } catch {
      return i18n.t('Base URL must be a valid http(s) URL.');
    }
    if (!form.model.trim()) return i18n.t('Model name is required.');

    const trimmedMax = form.max_output_tokens.trim();
    if (trimmedMax && (!/^\d+$/.test(trimmedMax) || Number(trimmedMax) < 1)) {
      return i18n.t('Max output tokens must be a whole number, or blank for no cap.');
    }
    return null;
  };

  const parsedMaxOutputTokens = (): number | null => {
    const trimmed = form.max_output_tokens.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  };

  const parsedContextWindow = (): number | null => {
    const trimmed = form.context_window.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  };

  const saveProvider = () =>
    ipc.upsertAiProvider({
      id: form.id ?? null,
      name: form.name.trim(),
      kind: 'openai',
      base_url: form.base_url.trim(),
      api_key: form.api_key,
      model: form.model.trim(),
      default: form.default,
      response_language: form.response_language || 'auto',
      commit_language: form.commit_language || 'inherit',
      max_output_tokens: parsedMaxOutputTokens(),
      context_window: parsedContextWindow(),
    });

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await saveProvider();
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setTesting(true);
    setTestResult(null);
    try {
      const saved = await saveProvider();
      setForm((prev) => ({ ...prev, id: saved.id }));
      setTestResult(await ipc.testAiProvider(saved.id));
    } catch (error) {
      setTestResult({
        ok: false,
        latency_ms: 0,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border/60 bg-surface-muted/40 rounded-app-sm flex items-start gap-2 border p-2.5">
        <Sparkles className="text-accent mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p className="text-fg-dim text-[11px] leading-snug">
          {i18n.rich(
            'Any service that implements {value1} the OpenAI way will work — OpenAI, Azure OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together, Ollama, LM Studio, llama.cpp server, vLLM. If your provider lists "OpenAI compatibility" in their docs, it\'s compatible.',
            {
              value1: (
                <span className="text-fg/80 font-mono">{i18n.t('POST /chat/completions')}</span>
              ),
            },
          )}
        </p>
      </div>

      <Field
        label={i18n.t('Display Name')}
        hint={i18n.t("Shown in the picker — e.g. 'Production OpenAI'.")}
      >
        <Input
          value={form.name}
          autoFocus
          placeholder={i18n.t('My OpenAI')}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </Field>

      <Field
        label={i18n.t('Base URL')}
        hint={i18n.t(
          'The root that exposes /chat/completions — e.g. https://api.openai.com/v1 or http://localhost:11434/v1 (Ollama).',
        )}
      >
        <Input
          mono
          value={form.base_url}
          placeholder="https://api.openai.com/v1"
          onChange={(event) => setForm({ ...form, base_url: event.target.value })}
        />
      </Field>

      <Field
        label={
          <span className="flex items-center gap-1.5">
            {i18n.rich('API Key{value1}', {
              value1: (
                <span className="text-fg-dim text-[9.5px] font-normal tracking-wider uppercase">
                  {isLocalUrl ? i18n.t('— optional for local servers') : i18n.t('— optional')}
                </span>
              ),
            })}
          </span>
        }
        hint={
          isLocalUrl
            ? i18n.t(
                'Local servers like Ollama or LM Studio usually ignore this. Leave blank or use any placeholder.',
              )
            : i18n.t(
                'Stored locally in your RunHQ config. Some self-hosted gateways do not require a key.',
              )
        }
      >
        <div className="relative">
          <Input
            mono
            type={showKey ? 'text' : 'password'}
            value={form.api_key}
            placeholder={isLocalUrl ? i18n.t('leave blank') : i18n.t('sk-…')}
            onChange={(event) => setForm({ ...form, api_key: event.target.value })}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowKey((value) => !value)}
            className="text-fg-dim hover:text-fg absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center transition"
            tabIndex={-1}
            title={showKey ? i18n.t('Hide key') : i18n.t('Show key')}
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </Field>

      <Field
        label={i18n.t('Model')}
        hint={i18n.t(
          'The exact identifier the provider expects (e.g. gpt-4o-mini, llama3.2, mistral-small-latest).',
        )}
      >
        <Input
          mono
          value={form.model}
          placeholder={i18n.t('gpt-4o-mini')}
          onChange={(event) => setForm({ ...form, model: event.target.value })}
        />
      </Field>

      <Field
        label={i18n.t('Response Language')}
        hint={i18n.t(
          "The language the model should reply in across the conversational AI surfaces (chat, diff explainer, log triage, standup polish, project explainer). 'Auto' lets the model echo back whatever language you wrote in — usually the right default for chat. Pick a specific language if you want everything answered in it consistently. Commit messages are configured separately below.",
        )}
      >
        <LanguagePicker
          value={form.response_language || 'auto'}
          onChange={(next) => setForm({ ...form, response_language: next })}
        />
      </Field>

      <Field
        label={i18n.t('Commit Message Language')}
        hint={i18n.t(
          "The language for AI-generated commit messages. Kept separate from Response Language because commits enter the project's git history — many teams keep chat in their native tongue but commits in English regardless. 'Inherit' uses whatever Response Language is set above (the default — pick this if you don't care about the distinction). 'Auto' opts out of any language directive on commits even when chat has one (lets the model match the language of your existing diff comments and code). Or pick a specific language to force it for commits only.",
        )}
      >
        <LanguagePicker
          value={form.commit_language || 'inherit'}
          onChange={(next) => setForm({ ...form, commit_language: next })}
          options={COMMIT_LANGUAGE_OPTIONS}
        />
      </Field>

      <Field
        label={
          <span className="flex items-center gap-1.5">
            {i18n.rich('Max Output Tokens{value1}', {
              value1: (
                <span className="text-fg-dim text-[9.5px] font-normal tracking-wider uppercase">
                  {i18n.t('— optional')}
                </span>
              ),
            })}
          </span>
        }
        hint={i18n.t(
          "Hard ceiling on response length, in tokens. Leave blank for no cap — RunHQ will let your provider's own model-aware default apply (the right call for long-context models like Gemini 1M or Claude 200K, where you want big diff-history walk-throughs to fit). Set a number to clamp every AI surface (chat, diff explainer, log triage, standup, project, commit) — useful on small local models or when you want predictable costs. Common starting points: 4096 (most cloud models), 8192 (gpt-4o, Claude), or 32768+ for thinking models.",
        )}
      >
        <Input
          mono
          type="text"
          inputMode="numeric"
          value={form.max_output_tokens}
          placeholder={i18n.t('No cap (recommended)')}
          onChange={(event) =>
            setForm({ ...form, max_output_tokens: event.target.value.replace(/[^\d]/g, '') })
          }
        />
      </Field>

      <Field
        label={
          <span className="flex items-center gap-1.5">
            {i18n.rich('Context Window{value1}', {
              value1: (
                <span className="text-fg-dim text-[9.5px] font-normal tracking-wider uppercase">
                  {i18n.t('— optional')}
                </span>
              ),
            })}
          </span>
        }
        hint={i18n.t(
          "Total context window (input + output) in tokens. Used by the chat composer's token meter to render a 12.4k / 128k gauge with traffic-light coloring as you approach the cap. Leave blank to show just the raw count without a denominator. Common values: 8192 (older OSS), 32768 (Llama 3 base), 128000 (gpt-4o, Claude 3.5), 200000 (Claude 3 Opus), 1000000 (Gemini 1.5 Pro).",
        )}
      >
        <Input
          mono
          type="text"
          inputMode="numeric"
          value={form.context_window}
          placeholder="e.g. 128000"
          onChange={(event) =>
            setForm({ ...form, context_window: event.target.value.replace(/[^\d]/g, '') })
          }
        />
      </Field>

      <Switch
        checked={form.default}
        onChange={(value) => setForm({ ...form, default: value })}
        label={i18n.t('Use as default provider')}
        description={i18n.t('AI features will use this provider unless you pick another.')}
      />

      {testResult && (
        <div
          className={cn(
            'rounded-app-sm flex items-start gap-2 p-2.5 text-[11.5px]',
            testResult.ok
              ? 'border-status-running/30 bg-status-running/10 text-status-running border'
              : 'border-status-error/30 bg-status-error/10 text-status-error border',
          )}
        >
          {testResult.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {testResult.ok
                ? i18n.t('Connected in {value1} ms', { value1: testResult.latency_ms })
                : i18n.t('Connection failed')}
            </div>
            {testResult.message && (
              <div className="text-fg/80 mt-0.5 wrap-break-word">{testResult.message}</div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-status-error/10 border-status-error/30 text-status-error rounded-app-sm border p-2 text-[11.5px]">
          {error}
        </div>
      )}

      <div className="border-border mt-2 flex items-center justify-between border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTest}
          disabled={saving || testing}
          leftIcon={
            testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />
          }
        >
          {testing ? i18n.t('Testing…') : i18n.t('Save & Test')}
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            {i18n.t('Cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving
              ? i18n.t('Saving…')
              : isEdit
                ? i18n.t('Update Provider')
                : i18n.t('Add Provider')}
          </Button>
        </div>
      </div>
    </div>
  );
}
