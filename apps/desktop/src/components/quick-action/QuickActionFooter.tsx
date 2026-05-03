import { Zap } from 'lucide-react';

export function QuickActionFooter({ inDrill }: { inDrill: boolean }) {
  return (
    <div className="border-border/30 bg-surface-muted/30 border-t px-4 py-1.5">
      <div className="text-fg-dim flex items-center gap-3 text-[10px]">
        <span>↑↓ navigate</span>
        {inDrill ? (
          <>
            <span>⏎ run</span>
            <span>← back</span>
            <span>⌫ empty=back</span>
          </>
        ) : (
          <>
            <span>→ details</span>
            <span>⏎ select</span>
            <span>↹ category</span>
          </>
        )}
        <span>esc {inDrill ? 'back' : 'close'}</span>
        <span className="ml-auto flex items-center gap-1">
          <Zap className="text-accent h-2.5 w-2.5" />
          RunHQ
        </span>
      </div>
    </div>
  );
}
