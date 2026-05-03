import { History } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="bg-surface flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="bg-surface-muted/60 ring-border flex h-16 w-16 items-center justify-center rounded-2xl ring-1">
        <History className="text-fg-dim h-7 w-7" />
      </div>
      <p className="text-fg text-[14px] font-medium">No release history yet</p>
      <p className="text-fg-dim max-w-sm text-[12px] leading-relaxed">
        Curated highlights show up here after the first shipped release. In the meantime, the full
        developer-facing record lives in CHANGELOG.md.
      </p>
    </div>
  );
}

export function SelectionEmpty() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <p className="text-fg-dim text-[12px]">Pick a release on the left to see its highlights.</p>
    </div>
  );
}
