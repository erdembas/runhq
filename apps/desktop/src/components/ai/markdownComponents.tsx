import type { Components } from 'react-markdown';
import { CopyableCodeBlock } from '@/components/ui/CopyableCodeBlock';
import { extractMarkdownText, findCodeChild } from '@/lib/markdownText';

/**
 * Shared `react-markdown` component map used by every AI surface
 * (chat panel turns, AiAnswer card, popovers).
 *
 * Why one set:
 *   - Before this file, the chat panel and AiAnswer each shipped
 *     their own incomplete component map. Chat omitted headings,
 *     blockquotes, italics, hr, and tables; AiAnswer omitted
 *     blockquotes and tables. Markdown that looked great in one
 *     surface looked plain (or broken) in the other.
 *   - The user explicitly asked for proper markdown rendering
 *     ("Responselar markdown ise markdown previewer aracılığıyla
 *     görünmeli"). A shared, exhaustive map is the only way to
 *     keep that promise without re-introducing surface drift the
 *     next time we add an AI feature.
 *
 * Density variants:
 *   - `compact`: tight spacing for inline answers (chat turns,
 *     popovers). 12.5px body, 11px code.
 *   - `roomy`: roomier spacing for full-width drawers / dialogs.
 *     Slightly larger headings, more vertical rhythm.
 */
export type MarkdownDensity = 'compact' | 'roomy';

export function buildMarkdownComponents(density: MarkdownDensity = 'compact'): Components {
  const isCompact = density === 'compact';

  return {
    // Paragraphs.
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,

    // Headings. We cap visual size aggressively because chat turns
    // are usually 200-400px wide; a giant `<h1>` would dwarf the
    // surrounding prose. Models still get the semantic hierarchy
    // (the underlying tag is still <h1>/<h2>/<h3>) for screen
    // readers and copy-paste.
    h1: ({ children }) => (
      <h1
        className={`text-fg mt-2 mb-1.5 font-semibold first:mt-0 ${
          isCompact ? 'text-[14px]' : 'text-[15px]'
        }`}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className={`text-fg mt-2 mb-1.5 font-semibold first:mt-0 ${
          isCompact ? 'text-[13px]' : 'text-[14px]'
        }`}
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className={`text-fg mt-1.5 mb-1 font-semibold first:mt-0 ${
          isCompact ? 'text-[12.5px]' : 'text-[13px]'
        }`}
      >
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-fg mt-1.5 mb-1 text-[12px] font-semibold first:mt-0">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-fg mt-1 mb-0.5 text-[11.5px] font-semibold first:mt-0">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-fg-dim mt-1 mb-0.5 text-[11px] font-semibold tracking-wide uppercase first:mt-0">
        {children}
      </h6>
    ),

    // Lists.
    ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
    li: ({ children }) => <li className="mb-0.5 last:mb-0">{children}</li>,

    // Inline emphasis.
    strong: ({ children }) => <strong className="text-fg font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="text-fg-dim line-through">{children}</del>,

    // Code. The `<code>` callback runs for both inline (`a` ticks)
    // and fenced (```) blocks; we differentiate by the absence of
    // a `language-*` className that `react-markdown` sets on fenced
    // blocks. Fenced blocks are wrapped by `<pre>`, so we only
    // style the code body here — `<pre>` below provides the gutter.
    code: ({ className: cls, children }) => {
      const isInline = !cls;
      if (isInline) {
        return (
          <code className="bg-fg/10 text-fg rounded px-1 py-px font-mono text-[11px]">
            {children}
          </code>
        );
      }
      return (
        <code className={`text-fg block font-mono ${isCompact ? 'text-[11px]' : 'text-[11.5px]'}`}>
          {children}
        </code>
      );
    },
    // Fenced code blocks. Wrap the styled `<pre>` with a hovered
    // copy-to-clipboard button so users can grab a snippet without
    // selecting it manually. Inline `<code>` (handled above) stays
    // unwrapped — copying a one-token identifier is faster with
    // a regular triple-click + Cmd+C than via a button.
    pre: ({ children }) => {
      const codeEl = findCodeChild(children);
      const language = codeEl?.className?.toString().match(/language-([^\s]+)/)?.[1] ?? null;
      const raw = codeEl ? extractMarkdownText(codeEl.children) : extractMarkdownText(children);
      return (
        <CopyableCodeBlock
          raw={raw.replace(/\n+$/, '')}
          language={language}
          preClassName={isCompact ? 'text-[11px]' : 'text-[11.5px]'}
        >
          {children}
        </CopyableCodeBlock>
      );
    },

    // Block quote — used for citations / model nuance ("Note: ...").
    blockquote: ({ children }) => (
      <blockquote className="border-accent/40 text-fg-dim my-2 border-l-2 pl-3 italic first:mt-0 last:mb-0">
        {children}
      </blockquote>
    ),

    // Horizontal rule. Subtle, just a visual breath.
    hr: () => <hr className="border-border/40 my-3" />,

    // Tables (GFM). Wrapped in an overflow container so wide
    // columns don't blow out the chat width.
    table: ({ children }) => (
      <div className="border-border/50 my-2 overflow-x-auto rounded border">
        <table className="w-full border-collapse text-[11.5px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-fg/5">{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className="border-border/40 border-b last:border-b-0">{children}</tr>,
    th: ({ children }) => <th className="text-fg px-2 py-1 text-left font-semibold">{children}</th>,
    td: ({ children }) => <td className="text-fg/90 px-2 py-1 align-top">{children}</td>,

    // Links — open in a new window/tab. The Tauri webview honors
    // `target="_blank"` by routing to the OS default browser when
    // the shell allowlist includes the target host. For internal
    // anchors (`href` starting with `#`) the same target works as
    // a no-op; we don't ship in-document anchors today.
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent hover:underline"
      >
        {children}
      </a>
    ),

    // Images. Constrained max-height so a model dropping a 4k
    // screenshot URL doesn't push the rest of the conversation
    // off-screen.
    img: ({ src, alt }) => (
      <img
        src={src}
        alt={alt ?? ''}
        className="border-border/40 my-2 max-h-[280px] rounded border"
      />
    ),
  };
}

/** Memoized "compact" set — used by chat turns and popovers. */
export const COMPACT_MARKDOWN_COMPONENTS = buildMarkdownComponents('compact');

/** Memoized "roomy" set — used by full-width AiAnswer cards. */
export const ROOMY_MARKDOWN_COMPONENTS = buildMarkdownComponents('roomy');
