import { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Pencil, Star, Trash2, Zap } from 'lucide-react';
import {
  commitLanguageLabel,
  commitLanguageOption,
  languageLabel,
} from '@/components/ai-provider-manager/languageOptions';
import { cn } from '@/lib/cn';
import type { AiProvider, AiTestResult } from '@/types';

interface AiProviderRowProps {
  provider: AiProvider;
  test?: AiTestResult & { busy?: boolean };
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onSetDefault: () => void;
}

export function AiProviderRow({
  provider,
  test,
  onTest,
  onEdit,
  onRemove,
  onSetDefault,
}: AiProviderRowProps) {
  const maskedKey = useMemo(() => maskApiKey(provider.api_key), [provider.api_key]);
  const baseLabel = useMemo(() => {
    try {
      return new URL(provider.base_url).host;
    } catch {
      return provider.base_url;
    }
  }, [provider.base_url]);
  const commitLanguage = commitLanguageOption(provider.commit_language);

  return (
    <li
      className={cn(
        'border-border bg-surface-raised/40 hover:border-border-strong rounded-app-sm flex items-center gap-3 border p-3 transition',
        provider.default && 'border-accent/40 bg-accent/5',
      )}
    >
      <button
        type="button"
        onClick={onSetDefault}
        title={provider.default ? 'Default provider' : 'Use as default'}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition',
          provider.default
            ? 'bg-accent/15 text-accent'
            : 'text-fg-dim hover:bg-fg/10 hover:text-fg',
        )}
      >
        <Star className={cn('h-3.5 w-3.5', provider.default && 'fill-current')} strokeWidth={2} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-fg truncate text-[12.5px] font-semibold">{provider.name}</span>
          {provider.default && (
            <span className="bg-accent/15 text-accent rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider uppercase">
              Default
            </span>
          )}
        </div>
        <div className="text-fg-dim mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px]">
          <span className="truncate" title={provider.base_url}>
            {baseLabel}
          </span>
          <span>·</span>
          <span className="truncate">{provider.model}</span>
          <span>·</span>
          <span title="API key (masked)">{maskedKey}</span>
          <span>·</span>
          <span title="Response language" className="truncate">
            {languageLabel(provider.response_language)}
          </span>
          {commitLanguage?.value && commitLanguage.value !== 'inherit' && (
            <>
              <span>·</span>
              <span title="Commit message language" className="truncate">
                ✎ {commitLanguageLabel(provider.commit_language, provider.response_language)}
              </span>
            </>
          )}
          {provider.max_output_tokens != null && provider.max_output_tokens > 0 && (
            <>
              <span>·</span>
              <span title="Max output tokens (per-provider cap)">
                ≤ {provider.max_output_tokens.toLocaleString()} tok
              </span>
            </>
          )}
        </div>
        {test && (
          <div
            className={cn(
              'mt-1.5 flex items-center gap-1.5 text-[10.5px]',
              test.busy ? 'text-fg-dim' : test.ok ? 'text-status-running' : 'text-status-error',
            )}
          >
            {test.busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : test.ok ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <AlertCircle className="h-3 w-3" />
            )}
            <span className="truncate">
              {test.busy
                ? 'Testing connection…'
                : test.ok
                  ? `Connected · ${test.latency_ms} ms${test.model ? ` · ${test.model}` : ''}`
                  : (test.message ?? 'Connection failed')}
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onTest}
          disabled={test?.busy}
          className="text-fg-dim hover:bg-fg/10 hover:text-fg flex h-7 items-center gap-1 rounded px-2 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50"
          title="Test connection"
        >
          <Zap className="h-3 w-3" />
          Test
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="text-fg-dim hover:bg-fg/10 hover:text-fg flex h-7 w-7 items-center justify-center rounded transition"
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-fg-dim flex h-7 w-7 items-center justify-center rounded transition hover:bg-rose-500/10 hover:text-rose-500"
          title="Remove"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

function maskApiKey(key: string): string {
  if (!key) return '(no key)';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-3)}`;
}
