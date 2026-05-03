import { Search, X } from 'lucide-react';

interface FileSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function FileSearchInput({
  value,
  onChange,
  placeholder = 'Search files…',
}: FileSearchInputProps) {
  return (
    <div className="border-border border-b px-2 py-1.5">
      <div className="border-border bg-surface focus-within:border-accent/50 flex h-7 items-center gap-1.5 rounded border px-2 transition-colors">
        <Search size={11} className="text-fg/40 shrink-0" />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="text-fg placeholder:text-fg/30 min-w-0 flex-1 bg-transparent text-[11px] outline-none"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="text-fg/40 hover:text-fg shrink-0 cursor-pointer transition"
            title="Clear"
            type="button"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
