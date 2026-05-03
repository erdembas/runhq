import { Check, Settings, Sparkles } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { AiProvider } from '@/types';

/**
 * Floating model picker shown above the composer's pill button.
 *
 * Anatomy:
 *   - Provider list: each row shows the human name + the configured
 *     model id (smaller, dim) so the user can disambiguate two
 *     providers pointing at the same model id (e.g. local Ollama
 *     vs. OpenAI for `gpt-4o`).
 *   - Active row gets a check mark on the right and an accent text
 *     colour. Hover lifts non-active rows.
 *   - Footer divider + "Manage providers…" item that opens the AI
 *     Settings dialog. Even with one provider configured we keep
 *     this visible so the user can edit `max_output_tokens` /
 *     base URL without hunting for the gear icon.
 *
 * Positioning: the pill is anchored bottom-aligned, the picker
 * pops up *above* it (`bottom-full mb-1`) so it doesn't push the
 * send button off-screen. Width is capped at 280px which fits
 * even the longest provider name + model combos we've seen
 * without truncating ("OpenAI Production · gpt-4o-mini-2024-07-18").
 */
export function ModelPicker({
  providers,
  activeId,
  onSelect,
  onManage,
  awaitingAutoSend = false,
}: {
  providers: AiProvider[];
  activeId: string;
  onSelect: (p: AiProvider) => void;
  onManage: () => void;
  /** When true, the picker was opened by a surface-triggered draft
   *  (Why? / Diff Explain / etc) with `autoSend: true` and 2+
   *  configured providers. Selecting a row will fire the send
   *  immediately. We surface a one-line hint at the top of the list
   *  so the click doesn't feel like a surprise. */
  awaitingAutoSend?: boolean;
}) {
  return (
    <div
      role="listbox"
      className={cn(
        'absolute bottom-full left-0 z-50 mb-1.5',
        'bg-surface-raised border-border/80 max-w-[320px] min-w-[260px]',
        'rounded-app overflow-hidden border shadow-lg shadow-black/30',
      )}
    >
      {awaitingAutoSend && (
        <div
          className={cn(
            'border-border/60 bg-accent/8 text-accent',
            'border-b px-2.5 py-1.5 text-[10.5px] font-medium tracking-wide uppercase',
          )}
        >
          Pick a model to send
        </div>
      )}
      <div className="max-h-[280px] overflow-y-auto py-1">
        {providers.length === 0 ? (
          <div className="text-fg-dim px-2.5 py-2 text-[11px]">No providers configured.</div>
        ) : (
          providers.map((p) => {
            const isActive = p.id === activeId;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => onSelect(p)}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                  'hover:bg-fg/5',
                  isActive && 'bg-accent/8',
                )}
              >
                <Sparkles
                  className={cn('h-3 w-3 shrink-0', isActive ? 'text-accent' : 'text-fg-dim/70')}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'truncate text-[11.5px] font-medium',
                      isActive ? 'text-fg' : 'text-fg/85',
                    )}
                  >
                    {p.name}
                  </div>
                  {p.model && (
                    <div className="text-fg-dim/70 truncate font-mono text-[10px]">{p.model}</div>
                  )}
                </div>
                {isActive && <Check className="text-accent h-3 w-3 shrink-0" />}
              </button>
            );
          })
        )}
      </div>
      <div className="border-border/60 border-t">
        <button
          type="button"
          onClick={onManage}
          className={cn(
            'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
            'text-fg-dim hover:bg-fg/5 hover:text-fg text-[11px]',
          )}
        >
          <Settings className="h-3 w-3" />
          <span>Manage providers…</span>
        </button>
      </div>
    </div>
  );
}
