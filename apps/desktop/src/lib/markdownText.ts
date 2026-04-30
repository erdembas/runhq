import { Children, isValidElement, type ReactNode } from 'react';

/**
 * Recursively extract a plain-text representation of a React node tree.
 *
 * Used by the markdown surfaces (AI chat, project docs) to grab the
 * raw text inside a fenced code block so it can be copied to the
 * clipboard or piped to the integrated terminal — `react-markdown`
 * gives us a tree of styled spans, not a string, so we have to walk
 * the children ourselves.
 *
 * Handles every shape `react-markdown` produces in practice:
 *   - bare strings / numbers
 *   - arrays (rehype splits long lines into multiple spans)
 *   - React elements with their own `children` (syntax-highlight wrappers)
 *
 * Anything else (functions, portals, fragments without children) maps
 * to an empty string — we silently drop them rather than throwing,
 * since a "best-effort copy" is always better than a hard failure when
 * the user just wanted to grab a snippet.
 */
export function extractMarkdownText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractMarkdownText).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractMarkdownText(props.children);
  }
  return '';
}

/**
 * Find the first `<code>` descendant inside a `<pre>` block's
 * children. `react-markdown` always wraps fenced blocks as
 * `<pre><code class="language-foo">…</code></pre>`, but plugins
 * (`rehype-raw`, syntax highlighters) sometimes inject extra
 * wrappers — walking the tree is more robust than `Children.only`.
 */
export function findCodeChild(children: ReactNode): {
  className?: string;
  children?: ReactNode;
} | null {
  let found: { className?: string; children?: ReactNode } | null = null;
  Children.forEach(children, (child) => {
    if (found) return;
    if (isValidElement(child)) {
      if (child.type === 'code') {
        found = child.props as { className?: string; children?: ReactNode };
        return;
      }
      const props = child.props as { children?: ReactNode };
      const nested = findCodeChild(props.children);
      if (nested) found = nested;
    }
  });
  return found;
}
