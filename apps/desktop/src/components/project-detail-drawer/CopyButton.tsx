import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export function CopyButton({ value, label }: { value: string; label: string }) {
  i18n.useLocale();
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
      title={copied ? i18n.t('Copied') : `${label}: ${value}`}
      aria-label={copied ? i18n.t('Copied to clipboard') : label}
      className={cn(
        'rounded p-1 transition',
        copied ? 'text-tone-success-fg' : 'text-fg/45 hover:text-accent hover:bg-fg/5',
      )}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}
