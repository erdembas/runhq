import { useMemo, useState } from 'react';
import { Check, Copy, Play, ShieldAlert } from 'lucide-react';
import { evaluateRunCandidate } from '@/lib/docs/runGuard';
import { cn } from '@/lib/cn';

interface Props {
  /** The fence info-string captured by react-markdown (e.g. `bash`). */
  language: string | null;
  /** The raw text inside the fenced block, with trailing newline trimmed. */
  raw: string;
  /** The original `<code>` children — already rendered with syntax-highlighting CSS. */
  children: React.ReactNode;
  /**
   * Invoked when the user clicks Run. The host wires this up to
   * the integrated terminal pane (open it, then write the command
   * + carriage return through `ipc.terminalWrite`).
   */
  onRun: (command: string) => void;
}

/**
 * A fenced code block in the DOCS tab gets two affordances:
 *
 *   1. Copy — always available. Single click puts the raw block
 *      onto the clipboard. Visual feedback flips the icon to a
 *      check for ~1.5s so users see it took.
 *   2. Run — only available when `evaluateRunCandidate` says the
 *      command is on the allow-list and free of shell metachars.
 *      For everything else we render a disabled shield button
 *      whose tooltip explains why (multi-line script, unknown
 *      command, dangerous flag, etc.). Showing the disabled
 *      affordance instead of hiding it keeps the layout stable
 *      and educates the user about why we won't auto-run their
 *      `curl https://… | bash` line.
 *
 * The hover-only floating action row is positioned absolute over
 * the upper-right corner of the `<pre>`. We use opacity-on-hover
 * (rather than display:none) so users can tab into the buttons via
 * keyboard and so screen readers still announce them.
 */
export function RunnableCodeBlock({ language, raw, children, onRun }: Props) {
  const [copied, setCopied] = useState(false);
  const guard = useMemo(() => evaluateRunCandidate(language, raw), [language, raw]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('docs: copy failed', err);
    }
  };

  return (
    <div className="group relative">
      <pre className="bg-fg/5 border-border/40 mb-3 overflow-x-auto rounded border p-3 font-mono text-[12px] leading-relaxed">
        {children}
      </pre>
      <div
        className={cn(
          'absolute top-1.5 right-1.5 flex items-center gap-1',
          'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        {guard.runnable ? (
          <button
            type="button"
            onClick={() => onRun(guard.command)}
            title={`Run "${guard.command}" in the integrated terminal`}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded px-1.5',
              'border-border bg-surface text-fg-muted hover:bg-accent/15 hover:text-accent border',
              'text-[10.5px] font-medium transition-colors',
            )}
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Run</span>
          </button>
        ) : (
          <button
            type="button"
            disabled
            title={guard.reason ?? 'Run is unavailable for this block.'}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded px-1.5',
              'border-border/60 bg-surface text-fg-dim/70 cursor-not-allowed border',
              'text-[10.5px] font-medium',
            )}
          >
            <ShieldAlert className="h-3 w-3" />
            <span>Run</span>
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          title="Copy block to clipboard"
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded px-1.5',
            'border-border bg-surface text-fg-muted hover:bg-accent/15 hover:text-accent border',
            'text-[10.5px] font-medium transition-colors',
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}
