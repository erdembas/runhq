import { useCallback, useState, type RefObject } from 'react';
import { Sparkles } from 'lucide-react';
import { DocumentReleaseDetail } from '@/components/whatsnew/DocumentReleaseDetail';
import { MediaLightbox } from '@/components/whatsnew/MediaLightbox';
import { HighlightCopyBlock } from './HighlightCopyBlock';
import { HighlightVisual } from './HighlightVisual';
import { formatReleaseDate } from './model';
import type { DocumentRelease, WhatsNewRelease } from '@/lib/whatsnew';

interface ReleaseDetailProps {
  release: WhatsNewRelease;
  themeSuffix: 'light' | 'dark';
  onOpenModal: () => void;
  onAfterAction: () => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
}

export function ReleaseDetail({
  release,
  themeSuffix,
  onOpenModal,
  onAfterAction,
  scrollerRef,
}: ReleaseDetailProps) {
  const [lightbox, setLightbox] = useState<{
    src: string;
    alt: string;
    kind: 'image' | 'video';
  } | null>(null);
  const openZoom = useCallback(
    (media: { src: string; alt: string; kind: 'image' | 'video' }) => setLightbox(media),
    [],
  );
  const closeZoom = useCallback(() => setLightbox(null), []);

  if (release.kind === 'document') {
    return <DocumentReleaseDetail release={release as DocumentRelease} scrollerRef={scrollerRef} />;
  }

  const heroHighlight = release.highlights[0];
  const tail = release.highlights.slice(1);

  return (
    <>
      <article className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-fg text-[22px] leading-tight font-semibold tracking-tight">
              RunHQ {release.version}
            </h2>
            <span className="text-fg-dim/90 text-[12px]">·</span>
            <span className="text-fg-dim text-[12px]">
              Released {formatReleaseDate(release.releasedAt)}
            </span>
          </div>
          <p className="text-fg-muted text-[14px] leading-relaxed">{release.headline}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onOpenModal}
              className="text-accent hover:text-accent/85 inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
              title="Open the release modal with the same content in a focused popup"
            >
              <Sparkles className="h-3 w-3" />
              View as What&apos;s New
            </button>
            <span className="text-fg-dim/60 text-[11px]">·</span>
            <a
              href={release.changelogUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-dim hover:text-fg text-[11px] font-medium underline-offset-2 transition-colors hover:underline"
            >
              Read full changelog ↗
            </a>
          </div>
        </div>

        {heroHighlight && (
          <HighlightVisual highlight={heroHighlight} themeSuffix={themeSuffix} onZoom={openZoom} />
        )}

        {heroHighlight && (
          <HighlightCopyBlock highlight={heroHighlight} onAfter={onAfterAction} variant="hero" />
        )}

        {tail.length > 0 && (
          <div className="flex flex-col gap-8">
            {tail.map((highlight) => (
              <section key={highlight.id} className="flex flex-col gap-4">
                <HighlightVisual
                  highlight={highlight}
                  themeSuffix={themeSuffix}
                  onZoom={openZoom}
                />
                <HighlightCopyBlock
                  highlight={highlight}
                  onAfter={onAfterAction}
                  variant="stacked"
                />
              </section>
            ))}
          </div>
        )}

        <footer className="border-border mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <a
            href={release.changelogUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-fg-dim hover:text-fg text-[12px] font-medium underline-offset-2 transition-colors hover:underline"
          >
            Read full changelog ↗
          </a>
          <span className="text-fg-dim/80 text-[10px] tracking-wider uppercase">
            {release.highlights.length} highlight
            {release.highlights.length === 1 ? '' : 's'}
          </span>
        </footer>
      </article>
      {lightbox && (
        <MediaLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          kind={lightbox.kind}
          onClose={closeZoom}
        />
      )}
    </>
  );
}
