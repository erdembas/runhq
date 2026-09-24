import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { openProjectDoc } from '@/lib/workbenchNavigation';
import type { DocContent } from '@/types';
import { ProjectReadmeMarkdown } from './ProjectReadmeMarkdown';

const PREVIEW_HEIGHT = 360;
const control =
  'text-fg-muted hover:text-fg focus-visible:ring-accent/50 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] outline-none focus-visible:ring-2 disabled:opacity-40';

interface ReadmeState {
  scope: string;
  content: DocContent | null;
  error: string | null;
  loading: boolean;
}

export function ProjectReadmePreview({
  serviceId,
  cwd,
  visible,
}: {
  serviceId: string;
  cwd: string;
  visible: boolean;
}) {
  i18n.useLocale();
  const scope = JSON.stringify([serviceId, cwd]);
  const [state, setState] = useState<ReadmeState | null>(null);
  const [revision, setRevision] = useState(0);
  const current = state?.scope === scope ? state : null;

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    let request = 0;
    const load = async () => {
      const token = ++request;
      setState((previous) => ({
        scope,
        content: previous?.scope === scope ? previous.content : null,
        error: null,
        loading: true,
      }));
      try {
        const docs = await ipc.discoverProjectDocs(serviceId);
        if (!alive || token !== request) return;
        const readme = docs.find((doc) => doc.kind === 'readme');
        const content = readme ? await ipc.readProjectDoc(serviceId, readme.relative_path) : null;
        if (alive && token === request) setState({ scope, content, error: null, loading: false });
      } catch (error) {
        if (alive && token === request)
          setState({ scope, content: null, error: String(error), loading: false });
      }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [scope, serviceId, visible, revision]);

  // Missing and empty READMEs take no space. This read never blocks the rest of Overview.
  if (!current?.error && !current?.content?.markdown.trim()) return null;
  return (
    <ReadmeCard
      key={scope}
      serviceId={serviceId}
      content={current?.content ?? null}
      error={current?.error ?? null}
      loading={current?.loading ?? false}
      onRefresh={() => setRevision((value) => value + 1)}
    />
  );
}

function ReadmeCard({
  serviceId,
  content,
  error,
  loading,
  onRefresh,
}: {
  serviceId: string;
  content: DocContent | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  i18n.useLocale();
  const bodyId = useId();
  const card = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const selectDoc = useCallback((path: string) => openProjectDoc(serviceId, path), [serviceId]);
  const expand = useCallback(() => setExpanded(true), []);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollHeight > PREVIEW_HEIGHT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);
  return (
    <section
      ref={card}
      className="border-border overflow-hidden rounded-xl border"
      aria-busy={loading}
    >
      <header className="border-border bg-surface-raised/30 flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-fg flex min-w-0 items-center gap-2 text-[13px] font-medium">
          <BookOpen className="text-fg-dim h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{content?.relative_path ?? i18n.t('README')}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={control}
            disabled={loading}
            onClick={onRefresh}
            aria-label={i18n.t('Refresh README')}
            title={i18n.t('Refresh README')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
          {content && (
            <button
              type="button"
              className={control}
              onClick={() => openProjectDoc(serviceId, content.relative_path)}
            >
              {i18n.t('Open in Docs')}
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </header>
      {error ? (
        <div role="alert" className="space-y-2 p-5 text-[12px]">
          <p className="text-status-error">{i18n.t('Could not load README.')}</p>
          <p className="text-fg-dim break-words">{error}</p>
          <button type="button" className={control} onClick={onRefresh}>
            {i18n.t('Retry')}
          </button>
        </div>
      ) : (
        content && (
          <>
            <div className="relative">
              <div
                id={bodyId}
                className="overflow-hidden"
                style={{ maxHeight: expanded ? undefined : PREVIEW_HEIGHT }}
                onFocusCapture={expand}
              >
                <div ref={body} className="p-5 lg:p-6">
                  <ProjectReadmeMarkdown
                    serviceId={serviceId}
                    content={content}
                    onSelectDoc={selectDoc}
                    onExpand={expand}
                  />
                </div>
              </div>
              {!expanded && overflowing && (
                <div
                  className="from-surface pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent"
                  aria-hidden
                />
              )}
            </div>
            {overflowing && (
              <div className="border-border/60 flex justify-center border-t px-4 py-2">
                <button
                  type="button"
                  className={control}
                  aria-expanded={expanded}
                  aria-controls={bodyId}
                  onClick={() => {
                    setExpanded((value) => !value);
                    if (expanded) card.current?.scrollIntoView({ block: 'start' });
                  }}
                >
                  {expanded ? i18n.t('Show less') : i18n.t('Show more')}
                  {expanded ? (
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
