import { Sparkles } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="text-fg-dim flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-[12px]">
      <Sparkles className="text-accent/60 h-6 w-6" />
      <div className="flex flex-col gap-1.5">
        <p className="text-fg/80 font-medium">Ask anything about your projects.</p>
        <p className="text-[11px] leading-snug">
          The active service is automatically attached as context. For diff or log explanations
          right-click those surfaces — they have purpose-built popovers.
        </p>
      </div>
    </div>
  );
}
