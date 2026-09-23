import * as i18n from '@runhq/cockpit-ui/i18n';
import type { KeyboardEvent, Ref } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface MatchInfo {
  index: number;
  count: number;
}

interface LogXtermSearchBarProps {
  inputRef: Ref<HTMLInputElement>;
  matchInfo: MatchInfo | null;
  query: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onNext: () => void;
  onPrev: () => void;
}

export function LogXtermSearchBar({
  inputRef,
  matchInfo,
  query,
  onChange,
  onClose,
  onKeyDown,
  onNext,
  onPrev,
}: LogXtermSearchBarProps) {
  i18n.useLocale();
  return (
    <div
      className={cn(
        'border-border bg-surface-raised shadow-lg',
        'absolute top-2 right-3 z-10 flex items-center gap-1',
        'rounded-app-sm border px-1.5 py-1',
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={i18n.t('Find in logs…')}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          'border-border bg-surface-muted/70 text-fg placeholder:text-fg-dim',
          'focus:border-accent/60 focus:bg-surface',
          'rounded-app-sm h-6 w-44 border px-2 text-[12px] transition focus:outline-none',
        )}
      />
      <span
        className={cn(
          'text-fg-dim min-w-[44px] px-1 text-center font-mono text-[10.5px] tabular-nums',
          matchInfo === null && query !== '' && 'text-status-error',
        )}
      >
        {matchInfo
          ? `${matchInfo.index}/${matchInfo.count}`
          : query === ''
            ? '0/0'
            : i18n.t('no match')}
      </span>
      <button
        type="button"
        onClick={onPrev}
        title={i18n.t('Previous match (Shift+Enter)')}
        aria-label={i18n.t('Previous match')}
        className="text-fg-dim hover:bg-surface-overlay hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
      >
        <ChevronUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onNext}
        title={i18n.t('Next match (Enter)')}
        aria-label={i18n.t('Next match')}
        className="text-fg-dim hover:bg-surface-overlay hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title={i18n.t('Close (Esc)')}
        aria-label={i18n.t('Close search')}
        className="text-fg-dim hover:bg-surface-overlay hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
