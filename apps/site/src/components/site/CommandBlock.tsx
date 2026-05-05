'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface Props {
  /** Multi-line text actually placed onto the clipboard. Newlines as \n. */
  copy: string;
  /** What gets shown to the user (one line). Lets us print
   *  `brew install --cask runhq` while copying the full
   *  `brew tap …\nbrew install --cask …` pair. */
  display: string;
}

/**
 * Self-contained copy-to-clipboard command block. Drops the
 * legacy `data-copy` HTML hack in favour of a tiny client component
 * — the only interactive bit on the install page, so the rest of
 * `<InstallSection>` stays a Server Component.
 */
export function CommandBlock({ copy, display }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof navigator === 'undefined' || !navigator.clipboard) return;
        navigator.clipboard.writeText(copy).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          },
          () => {},
        );
      }}
      className="border-border bg-surface text-fg-muted hover:border-accent/40 hover:text-fg group flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left font-mono text-[12px] transition"
    >
      <span className="text-accent select-none">$</span>
      <code className="truncate">{display}</code>
      <span className="text-fg-dim group-hover:text-accent ml-auto inline-flex items-center gap-1 text-[10.5px] uppercase">
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            copy
          </>
        )}
      </span>
    </button>
  );
}
