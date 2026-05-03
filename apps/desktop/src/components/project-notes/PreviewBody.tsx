import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText, Lock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { ROOMY_MARKDOWN_COMPONENTS } from '@/components/ai/markdownComponents';
import { cn } from '@/lib/cn';
import { DOCS_SANITIZE_SCHEMA } from '@/lib/docs/sanitizeSchema';
import { cssEscape, slugify } from './model';
import { Toc } from './Toc';
import type { TocHeading } from './types';

interface PreviewBodyProps {
  content: string;
  serviceName: string;
  wide: boolean;
}

export function PreviewBody({ content, serviceName, wide }: PreviewBodyProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);

  useLayoutEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const collected: TocHeading[] = [];
    const used = new Set<string>();
    const elements = root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3');
    elements.forEach((element) => {
      const text = (element.textContent ?? '').trim();
      if (!text) return;
      let id = slugify(text);
      let suffix = 1;
      while (used.has(id)) {
        id = `${slugify(text)}-${suffix++}`;
      }
      used.add(id);
      element.id = id;
      collected.push({
        id,
        level: parseInt(element.tagName.slice(1), 10),
        text,
      });
    });
    setHeadings(collected);
    setActiveHeading(collected[0]?.id ?? null);
  }, [content]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || headings.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const headingEls: HTMLElement[] = [];
    for (const heading of headings) {
      const element = root.querySelector(`#${cssEscape(heading.id)}`);
      if (element instanceof HTMLElement) headingEls.push(element);
    }
    if (headingEls.length === 0) return;

    const intersecting = new Set<string>();
    const idOrder = headings.map((heading) => heading.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (entry.isIntersecting) intersecting.add(id);
          else intersecting.delete(id);
        }
        for (const id of idOrder) {
          if (intersecting.has(id)) {
            setActiveHeading((previous) => (previous === id ? previous : id));
            return;
          }
        }
      },
      { root, rootMargin: '0px 0px -85% 0px', threshold: 0 },
    );
    for (const element of headingEls) observer.observe(element);
    return () => observer.disconnect();
  }, [headings]);

  if (content.length === 0) {
    return (
      <div className="text-fg-dim flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[12.5px]">
        <FileText className="text-fg-dim/60 h-6 w-6" />
        <p className="max-w-sm leading-relaxed">
          Empty note. Switch to <span className="font-medium">Edit</span> to start writing.
        </p>
        <p className="text-fg-muted/90 max-w-sm text-[11px] leading-relaxed">
          <Lock className="mr-1 inline-block h-3 w-3 align-[-2px]" />
          Local-only — saved to your RunHQ folder, never to the repo.
        </p>
      </div>
    );
  }

  const showToc = headings.length >= 3;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-6 py-5">
        <article
          className={cn(
            'text-fg/95 mx-auto text-[13px] leading-relaxed',
            wide ? 'max-w-none' : 'max-w-3xl',
          )}
          aria-label={`${serviceName} — note preview`}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, DOCS_SANITIZE_SCHEMA]]}
            components={ROOMY_MARKDOWN_COMPONENTS}
          >
            {content}
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
