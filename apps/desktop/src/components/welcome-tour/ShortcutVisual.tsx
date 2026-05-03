import { Kbd } from '@/components/ui/Kbd';
import { MOD_SYMBOL } from '@/lib/platform';

export function ShortcutVisual() {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex items-center gap-1.5 font-mono text-sm">
        <Kbd>{MOD_SYMBOL}</Kbd>
        <span className="text-fg-dim">+</span>
        <Kbd>⇧</Kbd>
        <span className="text-fg-dim">+</span>
        <Kbd>K</Kbd>
        <span className="text-fg-dim ml-2 text-[11px]">— from anywhere</span>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-sm">
        <Kbd>{MOD_SYMBOL}</Kbd>
        <span className="text-fg-dim">+</span>
        <Kbd>K</Kbd>
        <span className="text-fg-dim ml-2 text-[11px]">— inside RunHQ</span>
      </div>
    </div>
  );
}
