import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      title={copied ? 'Copied' : `${label}: ${value}`}
      aria-label={copied ? 'Copied to clipboard' : label}
      className={cn(
        'rounded p-1 transition',
        copied ? 'text-tone-success-fg' : 'text-fg/45 hover:text-accent hover:bg-fg/5',
      )}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}
