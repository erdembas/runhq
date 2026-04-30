import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  /**
   * The raw text of the fenced code block — what gets written to
   * the clipboard. Pre-extracted by the caller (via
   * `extractMarkdownText`) so this component stays presentational.
   */
  raw: string;
  /**
   * Optional language label rendered as a tiny pill on the left
   * side of the action row. Drops to nothing when null/empty.
   * `react-markdown` ships the language as `language-foo` on the
   * `<code>` className; the caller strips the prefix.
   */
  language?: string | null;
  /**
   * Already-styled `<code>` content from `react-markdown`. We just
   * wrap it — the markdown component map controls the inner
   * font / color / size, while this component owns the gutter,
   * border, and floating action row.
   */
  children: ReactNode;
  /**
   * Tailwind classes for the `<pre>` wrapper. Each markdown
   * surface (chat, AiAnswer, popovers) uses a slightly different
   * font size / spacing, so we accept the styling from the caller
   * instead of hard-coding it here.
   */
  preClassName?: string;
}

/**
 * A fenced markdown code block with a copy-to-clipboard button
 * floating in the top-right corner.
 *
 * Why hover-reveal:
 *   The button is opacity-0 by default and fades in on hover (or
 *   keyboard focus inside the block) so it doesn't compete with
 *   the prose itself when the user is just reading. Same UX
 *   pattern as GitHub / VS Code preview / Slack — users find it
 *   without instruction because muscle memory points them at the
 *   top-right corner of any code block.
 *
 * Why opacity-0 instead of `display: none`:
 *   Hidden buttons aren't focusable and screen readers skip them
 *   entirely. Keeping them in the layout (just transparent) means
 *   keyboard users can Tab to the copy button and hear it
 *   announced; sighted users only see it on intent (hover).
 *
 * Failure mode:
 *   `navigator.clipboard.writeText` can reject in sandboxed iframes
 *   or when the document isn't focused (rare in a Tauri webview but
 *   possible right after Cmd+Tab). We swallow the error and log to
 *   `console.warn` rather than surfacing a red banner — the user
 *   will simply notice the icon didn't tick over and re-click.
 */
export function CopyableCodeBlock({ raw, language, children, preClassName }: Props) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('markdown: copy failed', err);
    }
  };

  return (
    <div className="group relative">
      <pre
        className={cn(
          'bg-fg/5 border-border/40 mb-2 overflow-x-auto rounded border p-2 last:mb-0',
          preClassName,
        )}
      >
        {children}
      </pre>
      <div
        className={cn(
          'pointer-events-none absolute top-1.5 right-1.5 flex items-center gap-1.5',
          'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        {language && (
          <span
            className={cn(
              'border-border/60 bg-surface/80 text-fg-dim/80 rounded border px-1.5 py-px',
              'font-mono text-[9.5px] tracking-wide uppercase',
            )}
          >
            {language}
          </span>
        )}
        <button
          type="button"
          onClick={onCopy}
          title="Copy code to clipboard"
          aria-label="Copy code to clipboard"
          className={cn(
            'pointer-events-auto inline-flex h-6 items-center gap-1 rounded px-1.5',
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
