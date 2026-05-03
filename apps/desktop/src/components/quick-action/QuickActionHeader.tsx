import { ChevronLeft, Zap } from 'lucide-react';

interface QuickActionHeaderProps {
  inDrill: boolean;
  drillName: string | null;
  query: string;
  inputRef: React.Ref<HTMLInputElement>;
  onQueryChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBack: () => void;
}

export function QuickActionHeader({
  inDrill,
  drillName,
  query,
  inputRef,
  onQueryChange,
  onKeyDown,
  onBack,
}: QuickActionHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {inDrill ? (
        <button
          type="button"
          onClick={onBack}
          className="text-fg-dim hover:text-fg hover:bg-surface-muted/60 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition"
          title="Back"
          aria-label="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : (
        <Zap className="text-accent h-[18px] w-[18px] shrink-0" strokeWidth={2.25} />
      )}
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={inDrill ? `Filter ${drillName}…` : 'Search services, commands, actions…'}
        className="qa-search-input text-fg placeholder:text-fg-dim/80 h-7 w-full bg-transparent text-[15px] font-normal tracking-[-0.01em]"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
      />
    </div>
  );
}
