import { useLayoutEffect, useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { COMPACT_MARKDOWN_COMPONENTS } from '@/components/ai/markdownComponents';
import { DocImage } from '@/components/docs/DocImage';
import { resolveDocLink, slugify } from '@/components/docs/project-docs/docUtils';
import { DOCS_SANITIZE_SCHEMA } from '@/lib/docs/sanitizeSchema';
import type { DocContent } from '@/types';

interface Props {
  serviceId: string;
  content: DocContent;
  onSelectDoc: (path: string) => void;
  onExpand?: () => void;
}

/** The Docs renderer's safe Markdown presentation without its reader chrome or Run actions. */
export function ProjectReadmeMarkdown({ serviceId, content, onSelectDoc, onExpand }: Props) {
  const articleRef = useRef<HTMLElement>(null);
  const components = useMemo<Components>(
    () => ({
      ...COMPACT_MARKDOWN_COMPONENTS,
      h1: ({ node: _node, ...props }) => (
        <h1
          {...props}
          className="text-fg border-border/40 mt-2 mb-3 border-b pb-2 text-lg font-bold tracking-tight first:mt-0"
        />
      ),
      h2: ({ node: _node, ...props }) => (
        <h2 {...props} className="text-fg mt-5 mb-2 text-[15px] font-semibold first:mt-0" />
      ),
      h3: ({ node: _node, ...props }) => (
        <h3 {...props} className="text-fg mt-4 mb-1.5 text-[13.5px] font-semibold first:mt-0" />
      ),
      p: ({ node: _node, ...props }) => <p {...props} className="mb-3 last:mb-0" />,
      details: ({ node: _node, ...props }) => (
        <details
          {...props}
          className="border-border/50 bg-surface-muted/40 my-3 rounded-md border p-2"
        />
      ),
      summary: ({ node: _node, ...props }) => (
        <summary {...props} className="text-fg cursor-pointer text-[12.5px] font-medium" />
      ),
      a: ({ href, children, title }) => {
        if (!href) return <span>{children}</span>;
        if (href.startsWith('#')) {
          return (
            <a
              href={href}
              title={title}
              className="text-accent hover:underline"
              onClick={(event) => {
                event.preventDefault();
                let id = href.slice(1);
                try {
                  id = decodeURIComponent(id);
                } catch {
                  // Malformed document fragments are still safe to compare as literal IDs.
                }
                onExpand?.();
                requestAnimationFrame(() => {
                  const article = articleRef.current;
                  if (!article) return;
                  const target = Array.from(article.querySelectorAll<HTMLElement>('[id]')).find(
                    (element) => element.id === id || element.id === `user-content-${id}`,
                  );
                  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }}
            >
              {children}
            </a>
          );
        }
        const path = href.split(/[?#]/, 1)[0] ?? '';
        if (
          /\.(md|mdx|markdown)$/i.test(path) &&
          !/^[a-z][a-z\d+.-]*:/i.test(href) &&
          !href.startsWith('//')
        ) {
          const resolved = resolveDocLink(content.base_dir, href);
          return (
            <a
              href={href}
              title={title}
              className="text-accent hover:underline"
              onClick={(event) => {
                event.preventDefault();
                onSelectDoc(resolved);
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <a
            href={href}
            title={title}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt, width, height, node }) => (
        <DocImage
          serviceId={serviceId}
          baseDir={content.base_dir}
          src={src}
          alt={alt}
          width={width}
          height={height}
          align={typeof node?.properties.align === 'string' ? node.properties.align : undefined}
        />
      ),
    }),
    [serviceId, content.base_dir, onSelectDoc, onExpand],
  );

  useLayoutEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const used = new Set<string>();
    for (const heading of article.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
      const text = (heading.textContent ?? '').trim();
      if (!text) continue;
      const base = slugify(text);
      let id = base;
      let suffix = 1;
      while (used.has(id)) id = `${base}-${suffix++}`;
      used.add(id);
      heading.id = id;
    }
  }, [content.markdown, components]);

  return (
    <article
      ref={articleRef}
      className="text-fg/95 min-w-0 text-[13px] leading-relaxed break-words"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, DOCS_SANITIZE_SCHEMA]]}
        components={components}
      >
        {content.markdown}
      </ReactMarkdown>
    </article>
  );
}
