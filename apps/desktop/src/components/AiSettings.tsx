import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Zap,
} from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import type { AiProvider, AiTestResult } from '@/types';

interface AiSettingsProps {
  onClose: () => void;
}

interface FormState {
  id?: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  default: boolean;
  response_language: string;
  /** Stored as a *string* (not a number) inside the form because an
   *  empty input is semantically meaningful — it means "no client-side
   *  cap, let the server decide" — and a numeric state with `0`/`NaN`
   *  encoding would force every consumer to remember the convention.
   *  We parse to `number | null` only at the IPC boundary. */
  max_output_tokens: string;
  /** Optional context window (input + output) in tokens. Same string-
   *  encoding rationale as `max_output_tokens` — empty input means
   *  "unknown / no denominator", and the chat composer's TokenMeter
   *  hides the gauge when this is missing. */
  context_window: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  base_url: '',
  api_key: '',
  model: '',
  default: false,
  response_language: 'auto',
  max_output_tokens: '',
  context_window: '',
};

/**
 * Curated language list for the response-language picker.
 *
 * - `auto` is first because it's the right default for most users
 *   (the model echoes back whatever language the user wrote in,
 *   which is the modern multilingual-LLM behaviour).
 * - The native script in parentheses is what we ship to the model in
 *   the system prompt. Models recognise "Türkçe" / "Deutsch" /
 *   "日本語" much more reliably than the BCP-47 code alone.
 * - Order: Auto → English → speaker-count-ish ordering. Not strict —
 *   we want the user's likely choices clustered near the top.
 */
/**
 * Each option carries an emoji flag rendered inline in the picker.
 * `'auto'` uses a globe icon (lucide) instead of a flag because no
 * single country represents "match my message"; the menu renderer
 * recognises this by `flag === null`. Emoji glyphs are robust on
 * macOS / Windows 11 / modern Linux desktops; we don't ship a
 * sprite for them because a single emoji per row is cheaper than a
 * 16-flag sprite sheet. RTL languages (Arabic, Hebrew) keep `dir`
 * implicit on the row label since the emoji is leading and the
 * Latin-script transliteration follows it — no bidi reordering
 * issues observed in testing.
 */
const LANGUAGE_OPTIONS: { value: string; label: string; flag: string | null }[] = [
  { value: 'auto', label: 'Auto (match my message)', flag: null },
  { value: 'en', label: 'English', flag: '🇬🇧' },
  { value: 'tr', label: 'Turkish (Türkçe)', flag: '🇹🇷' },
  { value: 'de', label: 'German (Deutsch)', flag: '🇩🇪' },
  { value: 'fr', label: 'French (Français)', flag: '🇫🇷' },
  { value: 'es', label: 'Spanish (Español)', flag: '🇪🇸' },
  { value: 'it', label: 'Italian (Italiano)', flag: '🇮🇹' },
  { value: 'pt', label: 'Portuguese (Português)', flag: '🇵🇹' },
  { value: 'nl', label: 'Dutch (Nederlands)', flag: '🇳🇱' },
  { value: 'pl', label: 'Polish (Polski)', flag: '🇵🇱' },
  { value: 'ru', label: 'Russian (Русский)', flag: '🇷🇺' },
  { value: 'uk', label: 'Ukrainian (Українська)', flag: '🇺🇦' },
  { value: 'ja', label: 'Japanese (日本語)', flag: '🇯🇵' },
  { value: 'ko', label: 'Korean (한국어)', flag: '🇰🇷' },
  { value: 'zh', label: 'Chinese (中文)', flag: '🇨🇳' },
  { value: 'ar', label: 'Arabic (العربية)', flag: '🇸🇦' },
  { value: 'he', label: 'Hebrew (עברית)', flag: '🇮🇱' },
  { value: 'hi', label: 'Hindi (हिन्दी)', flag: '🇮🇳' },
];

function languageOption(value: string | null | undefined) {
  const v = (value ?? 'auto').trim().toLowerCase() || 'auto';
  return LANGUAGE_OPTIONS.find((o) => o.value === v);
}

function languageLabel(value: string | null | undefined): string {
  const opt = languageOption(value);
  if (!opt) return (value ?? 'auto').trim().toLowerCase() || 'auto';
  return opt.flag ? `${opt.flag} ${opt.label}` : opt.label;
}

/**
 * Flag-augmented language picker.
 *
 * Replaces the native `<select>` so we can show a country flag
 * next to each language. The native control on macOS will *not*
 * render emoji in option rows (it strips them down to text-only
 * before drawing), so a custom popover is the only way to keep
 * the flag glyphs visible across all platforms.
 *
 * UX:
 *   - Trigger button mirrors the height/border of our `Input`
 *     component so the field aligns with neighbouring `Field`
 *     blocks.
 *   - Click toggles a popover anchored to the trigger; selection
 *     closes it. Esc / outside-click also close.
 *   - Active row gets the accent colour and a check mark.
 *   - Keyboard: ArrowDown/Up move focus, Enter commits.
 */
function LanguagePicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState<number>(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // `LANGUAGE_OPTIONS[0]` is `auto`, which always exists at the top
  // of the constant list. The `!` here just placates the strict-
  // optional inference; runtime can never see undefined.
  const current = languageOption(value) ?? LANGUAGE_OPTIONS[0]!;

  // Filtered list driven by the search box. Match across both the
  // human label ("Türkçe") and the BCP-47 code ("tr"); searches are
  // case-insensitive and accent-insensitive so "Turkce", "türkçe",
  // and "tr" all surface the same entry. We don't sort: keeping the
  // original order preserves the curated "auto first, English next,
  // user's likely picks clustered" intent baked into LANGUAGE_OPTIONS.
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return LANGUAGE_OPTIONS;
    return LANGUAGE_OPTIONS.filter(
      (o) => normalize(o.label).includes(q) || normalize(o.value).includes(q),
    );
  }, [query]);

  // Reset / clamp the focus index whenever the visible list changes.
  // Without this the user could be focused on row 5, type a query
  // that returns 2 rows, and silently end up "out of bounds" — the
  // first ArrowDown would then visually jump from nothing to row 0.
  useEffect(() => {
    setFocusIdx((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current || !(e.target instanceof Node)) return;
      if (rootRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = filtered[focusIdx];
        if (opt) {
          onChange(opt.value);
          setOpen(false);
        }
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, focusIdx, onChange, filtered]);

  // Auto-focus the search box on open. Done in an effect (not via
  // `autoFocus` on the input itself) so re-opening the same picker
  // re-runs and reliably steals focus back even when React reuses
  // the DOM node from the previous open.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Scroll the focused row into view as the user arrows through
  // the list. Without this the highlighted row can drift past the
  // viewport on long lists (we have 18 entries; it only takes a
  // handful of arrow presses to lose track of it).
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${focusIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setQuery('');
          setFocusIdx(
            Math.max(
              0,
              LANGUAGE_OPTIONS.findIndex((o) => o.value === value),
            ),
          );
          setOpen((o) => !o);
        }}
        className={cn(
          'border-border bg-surface-muted/40 text-fg focus:border-accent/60 focus:bg-surface focus:ring-accent/20',
          'flex h-8 w-full items-center gap-2 rounded-md border px-2 text-[12px] transition outline-none focus:ring-2',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current.flag ? (
          <span className="text-[14px] leading-none">{current.flag}</span>
        ) : (
          <Globe className="text-fg-dim h-3.5 w-3.5 shrink-0" />
        )}
        <span className="flex-1 truncate text-left">{current.label}</span>
        <ChevronDown className="text-fg-dim h-3.5 w-3.5 shrink-0" />
      </button>
      {open && (
        <div
          className={cn(
            'border-border bg-surface-raised absolute z-30 mt-1 flex w-full flex-col',
            'rounded-md border shadow-lg',
          )}
        >
          <div className="border-border/60 relative border-b px-2 py-1.5">
            <Search className="text-fg-dim pointer-events-none absolute top-1/2 left-3.5 h-3 w-3 -translate-y-1/2" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search languages…"
              className={cn(
                'bg-surface-muted/40 text-fg placeholder:text-fg-dim/70',
                'border-border/40 focus:border-accent/40 focus:ring-accent/15',
                'h-7 w-full rounded border pr-2 pl-6 text-[11.5px] transition outline-none focus:ring-2',
              )}
            />
          </div>
          <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-fg-dim px-2 py-3 text-center text-[11px]">
                No languages match &ldquo;{query}&rdquo;
              </div>
            ) : (
              filtered.map((opt, idx) => {
                const active = opt.value === value;
                const focused = idx === focusIdx;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-idx={idx}
                    onMouseEnter={() => setFocusIdx(idx)}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] transition-colors',
                      focused ? 'bg-fg/5' : 'bg-transparent',
                      active ? 'text-accent' : 'text-fg',
                    )}
                  >
                    {opt.flag ? (
                      <span className="text-[14px] leading-none">{opt.flag}</span>
                    ) : (
                      <Globe className="text-fg-dim h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="flex-1 truncate">{opt.label}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AiSettings({ onClose }: AiSettingsProps) {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [removing, setRemoving] = useState<AiProvider | null>(null);
  const [testResults, setTestResults] = useState<Record<string, AiTestResult & { busy?: boolean }>>(
    {},
  );

  const reload = useCallback(async () => {
    try {
      const list = await ipc.listAiProviders();
      setProviders(list);
    } catch (err) {
      console.error('list_ai_providers failed', err);
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

  const startEdit = (p: AiProvider) => {
    setEditing({
      id: p.id,
      name: p.name,
      base_url: p.base_url,
      api_key: p.api_key,
      model: p.model,
      default: p.default,
      response_language: p.response_language ?? 'auto',
      max_output_tokens:
        p.max_output_tokens != null && p.max_output_tokens > 0 ? String(p.max_output_tokens) : '',
      context_window:
        p.context_window != null && p.context_window > 0 ? String(p.context_window) : '',
    });
  };

  const handleSetDefault = async (p: AiProvider) => {
    if (p.default) return;
    try {
      await ipc.setDefaultAiProvider(p.id);
      await reload();
    } catch (err) {
      console.error('set_default_ai_provider failed', err);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    try {
      await ipc.removeAiProvider(removing.id);
      setRemoving(null);
      await reload();
    } catch (err) {
      console.error('remove_ai_provider failed', err);
    }
  };

  const handleTest = async (p: AiProvider) => {
    setTestResults((prev) => ({
      ...prev,
      [p.id]: { ok: false, latency_ms: 0, busy: true },
    }));
    try {
      const result = await ipc.testAiProvider(p.id);
      setTestResults((prev) => ({ ...prev, [p.id]: { ...result, busy: false } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTestResults((prev) => ({
        ...prev,
        [p.id]: { ok: false, latency_ms: 0, message, busy: false },
      }));
    }
  };

  return (
    <Dialog
      title="AI Providers"
      subtitle="Connect any OpenAI-compatible chat completions endpoint"
      onClose={onClose}
      size="lg"
    >
      {editing ? (
        <ProviderForm
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

          {!loading && providers.length === 0 && <EmptyState onAdd={startNew} />}

          {!loading && providers.length > 0 && (
            <ul className="flex flex-col gap-2">
              {providers.map((p) => (
                <ProviderRow
                  key={p.id}
                  provider={p}
                  test={testResults[p.id]}
                  onTest={() => handleTest(p)}
                  onEdit={() => startEdit(p)}
                  onRemove={() => setRemoving(p)}
                  onSetDefault={() => handleSetDefault(p)}
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
    </Dialog>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="border-border bg-surface-muted/30 flex flex-col items-center gap-3 rounded-lg border border-dashed py-10">
      <Sparkles className="text-accent/70 h-7 w-7" />
      <div className="text-center">
        <div className="text-fg text-[13px] font-semibold">No AI providers yet</div>
        <p className="text-fg-dim mt-1 max-w-[380px] text-[11.5px] leading-snug">
          Point RunHQ at any OpenAI-compatible endpoint — a hosted gateway with your own key, or a
          local server like Ollama or LM Studio. Three fields: URL, optional key, model.
        </p>
      </div>
      <Button
        variant="primary"
        size="sm"
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        onClick={onAdd}
      >
        Add your first provider
      </Button>
    </div>
  );
}

interface ProviderRowProps {
  provider: AiProvider;
  test?: AiTestResult & { busy?: boolean };
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onSetDefault: () => void;
}

function ProviderRow({ provider, test, onTest, onEdit, onRemove, onSetDefault }: ProviderRowProps) {
  const maskedKey = useMemo(() => maskApiKey(provider.api_key), [provider.api_key]);
  const baseLabel = useMemo(() => {
    try {
      return new URL(provider.base_url).host;
    } catch {
      return provider.base_url;
    }
  }, [provider.base_url]);

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

interface ProviderFormProps {
  state: FormState;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}

function ProviderForm({ state, onCancel, onSaved }: ProviderFormProps) {
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
    if (!form.name.trim()) return 'Display name is required.';
    if (!form.base_url.trim()) return 'Base URL is required.';
    try {
      new URL(form.base_url.trim());
    } catch {
      return 'Base URL must be a valid http(s) URL.';
    }
    if (!form.model.trim()) return 'Model name is required.';
    const trimmedMax = form.max_output_tokens.trim();
    if (trimmedMax) {
      // Reject anything that isn't a clean positive integer. We allow
      // empty (= "no cap") and any whole number ≥ 1; `0`, decimals
      // and negative numbers don't have a meaningful interpretation
      // for `max_tokens` and would just produce a confusing API
      // error later. Catch it here with a friendly message.
      if (!/^\d+$/.test(trimmedMax)) {
        return 'Max output tokens must be a whole number, or blank for no cap.';
      }
      const n = Number(trimmedMax);
      if (!Number.isFinite(n) || n < 1) {
        return 'Max output tokens must be at least 1, or blank for no cap.';
      }
    }
    return null;
  };

  const parsedMaxOutputTokens = (): number | null => {
    const trimmed = form.max_output_tokens.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };

  const parsedContextWindow = (): number | null => {
    const trimmed = form.context_window.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await ipc.upsertAiProvider({
        id: form.id ?? null,
        name: form.name.trim(),
        kind: 'openai',
        base_url: form.base_url.trim(),
        api_key: form.api_key,
        model: form.model.trim(),
        default: form.default,
        response_language: form.response_language || 'auto',
        max_output_tokens: parsedMaxOutputTokens(),
        context_window: parsedContextWindow(),
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // "Test before save" path. We persist a temporary record by saving
  // first (preserving the user's input), then ping it. That's safer
  // than reaching deeper into the IPC and asking it to test an
  // unsaved blob — there's only one provider record on disk, and it
  // matches what the user is staring at.
  const handleTest = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setTesting(true);
    setTestResult(null);
    try {
      const saved = await ipc.upsertAiProvider({
        id: form.id ?? null,
        name: form.name.trim(),
        kind: 'openai',
        base_url: form.base_url.trim(),
        api_key: form.api_key,
        model: form.model.trim(),
        default: form.default,
        response_language: form.response_language || 'auto',
        max_output_tokens: parsedMaxOutputTokens(),
        context_window: parsedContextWindow(),
      });
      setForm((prev) => ({ ...prev, id: saved.id }));
      const result = await ipc.testAiProvider(saved.id);
      setTestResult(result);
    } catch (e) {
      setTestResult({
        ok: false,
        latency_ms: 0,
        message: e instanceof Error ? e.message : String(e),
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
          Any service that implements{' '}
          <span className="text-fg/80 font-mono">POST /chat/completions</span> the OpenAI way will
          work — OpenAI, Azure OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together, Ollama, LM
          Studio, llama.cpp server, vLLM. If your provider lists "OpenAI compatibility" in their
          docs, it's compatible.
        </p>
      </div>

      <Field label="Display Name" hint="Shown in the picker — e.g. 'Production OpenAI'.">
        <Input
          value={form.name}
          autoFocus
          placeholder="My OpenAI"
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>

      <Field
        label="Base URL"
        hint="The root that exposes /chat/completions — e.g. https://api.openai.com/v1 or http://localhost:11434/v1 (Ollama)."
      >
        <Input
          mono
          value={form.base_url}
          placeholder="https://api.openai.com/v1"
          onChange={(e) => setForm({ ...form, base_url: e.target.value })}
        />
      </Field>

      <Field
        label={
          <span className="flex items-center gap-1.5">
            API Key
            <span className="text-fg-dim text-[9.5px] font-normal tracking-wider uppercase">
              {isLocalUrl ? '— optional for local servers' : '— optional'}
            </span>
          </span>
        }
        hint={
          isLocalUrl
            ? 'Local servers like Ollama or LM Studio usually ignore this. Leave blank or use any placeholder.'
            : 'Stored locally in your RunHQ config. Some self-hosted gateways do not require a key.'
        }
      >
        <div className="relative">
          <Input
            mono
            type={showKey ? 'text' : 'password'}
            value={form.api_key}
            placeholder={isLocalUrl ? 'leave blank' : 'sk-…'}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="text-fg-dim hover:text-fg absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center transition"
            tabIndex={-1}
            title={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </Field>

      <Field
        label="Model"
        hint="The exact identifier the provider expects (e.g. gpt-4o-mini, llama3.2, mistral-small-latest)."
      >
        <Input
          mono
          value={form.model}
          placeholder="gpt-4o-mini"
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        />
      </Field>

      <Field
        label="Response Language"
        hint="The language the model should reply in across all AI surfaces (chat, diff explainer, log triage, standup polish, project explainer). 'Auto' lets the model echo back whatever language you wrote in — usually the right default for chat. Pick a specific language if you want everything answered in it consistently."
      >
        <LanguagePicker
          value={form.response_language || 'auto'}
          onChange={(next) => setForm({ ...form, response_language: next })}
        />
      </Field>

      <Field
        label={
          <span className="flex items-center gap-1.5">
            Max Output Tokens
            <span className="text-fg-dim text-[9.5px] font-normal tracking-wider uppercase">
              — optional
            </span>
          </span>
        }
        hint="Hard ceiling on response length, in tokens. Leave blank for no cap — RunHQ will let your provider's own model-aware default apply (the right call for long-context models like Gemini 1M or Claude 200K, where you want big diff-history walk-throughs to fit). Set a number to clamp every AI surface (chat, diff explainer, log triage, standup, project, commit) — useful on small local models or when you want predictable costs. Common starting points: 4096 (most cloud models), 8192 (gpt-4o, Claude), or 32768+ for thinking models."
      >
        <Input
          mono
          type="text"
          inputMode="numeric"
          value={form.max_output_tokens}
          placeholder="No cap (recommended)"
          onChange={(e) => {
            const next = e.target.value.replace(/[^\d]/g, '');
            setForm({ ...form, max_output_tokens: next });
          }}
        />
      </Field>

      <Field
        label={
          <span className="flex items-center gap-1.5">
            Context Window
            <span className="text-fg-dim text-[9.5px] font-normal tracking-wider uppercase">
              — optional
            </span>
          </span>
        }
        hint="Total context window (input + output) in tokens. Used by the chat composer's token meter to render a 12.4k / 128k gauge with traffic-light coloring as you approach the cap. Leave blank to show just the raw count without a denominator. Common values: 8192 (older OSS), 32768 (Llama 3 base), 128000 (gpt-4o, Claude 3.5), 200000 (Claude 3 Opus), 1000000 (Gemini 1.5 Pro)."
      >
        <Input
          mono
          type="text"
          inputMode="numeric"
          value={form.context_window}
          placeholder="e.g. 128000"
          onChange={(e) => {
            const next = e.target.value.replace(/[^\d]/g, '');
            setForm({ ...form, context_window: next });
          }}
        />
      </Field>

      <Switch
        checked={form.default}
        onChange={(v) => setForm({ ...form, default: v })}
        label="Use as default provider"
        description="AI features will use this provider unless you pick another."
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
              {testResult.ok ? `Connected in ${testResult.latency_ms} ms` : 'Connection failed'}
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
          {testing ? 'Testing…' : 'Save & Test'}
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update Provider' : 'Add Provider'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/// Render only the first 3 and last 3 chars of the key. We don't want
/// "sk-…" alone (uninformative) or the full key (leaks over screen
/// shares). 3+3 with a dotted bridge matches GitHub's masking.
function maskApiKey(key: string): string {
  if (!key) return '(no key)';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-3)}`;
}
