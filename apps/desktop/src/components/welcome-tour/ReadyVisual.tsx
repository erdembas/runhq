import { Rocket } from 'lucide-react';

export function ReadyVisual() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="bg-accent/15 text-accent flex h-16 w-16 items-center justify-center rounded-full">
        <Rocket className="h-8 w-8" strokeWidth={1.8} />
      </div>
      <div className="text-fg-dim text-center text-[12px] leading-relaxed">
        You can re-open this tour anytime from
        <span className="text-fg ml-1 font-medium">Settings → Shortcuts</span>.
      </div>
    </div>
  );
}
