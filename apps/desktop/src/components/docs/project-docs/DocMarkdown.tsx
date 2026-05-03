import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/lib/cn';
import { COMPACT_MARKDOWN_COMPONENTS } from '@/components/ai/markdownComponents';
import { DocImage } from '@/components/docs/DocImage';
import { DocsSearchBar } from '@/components/docs/DocsSearchBar';
import { RunnableCodeBlock } from '@/components/docs/RunnableCodeBlock';
import { DOCS_SANITIZE_SCHEMA } from '@/lib/docs/sanitizeSchema';
import { useDocsSearch } from '@/lib/docs/useDocsSearch';
import { extractMarkdownText, findCodeChild } from '@/lib/markdownText';
import type { DocContent } from '@/types';
import { cssEscape, resolveDocLink, slugify } from './docUtils';
import { Toc } from './Toc';
import type { Heading } from './types';

interface MarkdownProps {
  serviceId: string;
  content: DocContent;
  onRunCommand: (command: string) => void;
  onSelectDoc: (path: string) => void;
  wide: boolean;
}

export function DocMarkdown({
  serviceId,
  content,
  onRunCommand,
  onSelectDoc,
  wide,
}: MarkdownProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const search = useDocsSearch({ scrollerRef, contentKey: content.relative_path });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        const root = scrollerRef.current;
        if (!root || root.offsetParent === null) return;
        e.preventDefault();
        search.open();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [search]);

  useLayoutEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const collected: Heading[] = [];
    const used = new Set<string>();
    const elements = root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3');
    elements.forEach((el) => {
      const text = (el.textContent ?? '').trim();
      if (!text) return;
      let id = slugify(text);
      let suffix = 1;
      while (used.has(id)) id = `${slugify(text)}-${suffix++}`;
      used.add(id);
      el.id = id;
      collected.push({ id, level: parseInt(el.tagName.slice(1), 10), text });
    });
    setHeadings(collected);
    setActiveHeading(collected[0]?.id ?? null);
  }, [content.markdown]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || headings.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const headingEls: HTMLElement[] = [];
    for (const h of headings) {
      const el = root.querySelector(`#${cssEscape(h.id)}`);
      if (el instanceof HTMLElement) headingEls.push(el);
    }
    if (headingEls.length === 0) return;

    const intersecting = new Set<string>();
    const idOrder = headings.map((h) => h.id);
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (e.isIntersecting) intersecting.add(id);
          else intersecting.delete(id);
        }
        for (const id of idOrder) {
          if (intersecting.has(id)) {
            setActiveHeading((prev) => (prev === id ? prev : id));
            return;
          }
        }
      },
      {
        root,
        rootMargin: '0px 0px -85% 0px',
        threshold: 0,
      },
    );
    for (const el of headingEls) obs.observe(el);
    return () => obs.disconnect();
  }, [headings]);

  const components = useMemo(
    () => ({
      ...COMPACT_MARKDOWN_COMPONENTS,
      h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h1
          className="text-fg border-border/40 mt-2 mb-3 border-b pb-2 text-[18px] font-bold tracking-tight first:mt-0"
          {...props}
        />
      ),
      h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h2 className="text-fg mt-5 mb-2 text-[15px] font-semibold first:mt-0" {...props} />
      ),
      h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h3 className="text-fg mt-4 mb-1.5 text-[13.5px] font-semibold first:mt-0" {...props} />
      ),
      p: ({ children, ...rest }: React.HTMLAttributes<HTMLParagraphElement>) => (
        <p className="mb-3 last:mb-0" {...rest}>
          {children}
        </p>
      ),
      div: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
      span: (props: React.HTMLAttributes<HTMLSpanElement>) => <span {...props} />,
      details: (props: React.DetailsHTMLAttributes<HTMLDetailsElement>) => (
        <details
          className="border-border/50 bg-surface-muted/40 my-3 rounded-md border p-2"
          {...props}
        />
      ),
      summary: (props: React.HTMLAttributes<HTMLElement>) => (
        <summary
          className="text-fg cursor-pointer text-[12.5px] font-medium select-none"
          {...props}
        />
      ),
      picture: (props: React.HTMLAttributes<HTMLElement>) => <picture {...props} />,
      figure: (props: React.HTMLAttributes<HTMLElement>) => <figure className="my-3" {...props} />,
      figcaption: (props: React.HTMLAttributes<HTMLElement>) => (
        <figcaption className="text-fg-dim mt-1 text-center text-[11px]" {...props} />
      ),
      a: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
        if (!href) return <a {...rest}>{children}</a>;
        if (href.startsWith('#')) {
          return (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                const target = scrollerRef.current?.querySelector(href);
                if (target instanceof HTMLElement) {
                  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
              className="text-accent hover:underline"
            >
              {children}
            </a>
          );
        }
        if (
          /\.(md|mdx|markdown)$/i.test(href) &&
          !/^[a-z]+:\/\//i.test(href) &&
          !href.startsWith('mailto:')
        ) {
          const resolved = resolveDocLink(content.base_dir, href);
          return (
            <a
              href={`#doc:${resolved}`}
              onClick={(e) => {
                e.preventDefault();
                onSelectDoc(resolved);
              }}
              className="text-accent hover:underline"
            >
              {children}
            </a>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {children}
          </a>
        );
      },
      img: (props: React.ImgHTMLAttributes<HTMLImageElement> & { align?: string }) => {
        const { src, alt, width, height, align } = props;
        return (
          <DocImage
            serviceId={serviceId}
            baseDir={content.base_dir}
            src={typeof src === 'string' ? src : undefined}
            alt={typeof alt === 'string' ? alt : undefined}
            width={typeof width === 'number' || typeof width === 'string' ? width : undefined}
            height={typeof height === 'number' || typeof height === 'string' ? height : undefined}
            align={typeof align === 'string' ? align : undefined}
          />
        );
      },
      code: ({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) => {
        const langMatch = (className ?? '').match(/language-([^\s]+)/);
        if (!langMatch) {
          return (
            <code className="bg-fg/10 text-fg rounded px-1 py-px font-mono text-[11px]" {...rest}>
              {children}
            </code>
          );
        }
        return (
          <code
            className={cn('text-fg block font-mono text-[12px]', className)}
            data-lang={langMatch[1]}
          >
            {children}
          </code>
        );
      },
      pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => {
        const codeEl = findCodeChild(children);
        if (!codeEl) {
          return (
            <pre className="bg-fg/5 border-border/40 mb-3 overflow-x-auto rounded border p-3 font-mono text-[12px]">
              {children}
            </pre>
          );
        }
        const language = codeEl.className?.toString().match(/language-([^\s]+)/)?.[1] ?? null;
        const raw = extractMarkdownText(codeEl.children).replace(/\n+$/, '');
        return (
          <RunnableCodeBlock language={language} raw={raw} onRun={onRunCommand}>
            {children}
          </RunnableCodeBlock>
        );
      },
    }),
    [serviceId, content.base_dir, onRunCommand, onSelectDoc],
  );

  const showToc = headings.length >= 3;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {search.isOpen && (
        <DocsSearchBar
          query={search.query}
          setQuery={search.setQuery}
          matchInfo={search.matchInfo}
          onStep={search.step}
          onClose={search.close}
          onInputKeyDown={search.onInputKeyDown}
          inputRef={search.inputRef}
        />
      )}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-8 py-6">
        <article
          className={cn(
            'text-fg/95 mx-auto text-[13px] leading-relaxed',
            wide ? 'max-w-none' : 'max-w-3xl',
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, DOCS_SANITIZE_SCHEMA]]}
            components={components}
          >
            {content.markdown}
          </ReactMarkdown>
        </article>
      </div>
      {showToc && (
        <aside className="border-border/40 hidden w-[200px] shrink-0 overflow-y-auto border-l py-4 pr-4 pl-3 lg:block">
          <Toc
            headings={headings}
            activeId={activeHeading}
            onSelect={(id) => {
              const target = scrollerRef.current?.querySelector(`#${cssEscape(id)}`);
              if (target instanceof HTMLElement) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
          />
        </aside>
      )}
    </div>
  );
}
