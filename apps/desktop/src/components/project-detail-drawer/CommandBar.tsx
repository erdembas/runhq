import { useState, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export function CommandBar({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="group/cmd bg-fg/4 hover:bg-fg/6 border-border/60 flex items-stretch overflow-hidden rounded-md border transition">
      <code
        className="text-fg/75 min-w-0 flex-1 truncate px-2.5 py-1 font-mono text-[10.5px] tabular-nums"
        title={value}
      >
        <span className="text-fg/30 mr-1 select-none">$</span>
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          'border-border/60 inline-flex shrink-0 items-center gap-1 border-l px-2.5 text-[10px] font-medium tracking-wide transition',
          copied
            ? 'bg-tone-success/12 text-tone-success-fg'
            : 'text-fg/55 hover:bg-fg/8 hover:text-fg',
        )}
        title={copied ? 'Copied to clipboard' : 'Copy command'}
        aria-label={copied ? 'Copied to clipboard' : 'Copy command'}
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}
