import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { CtaButton } from './CtaButton';
import { InlineBulletGrid } from './InlineBulletGrid';
import { BADGE_LABEL, BADGE_TONE } from './model';
import type { Highlight } from '@/lib/whatsnew';

interface HighlightCopyBlockProps {
  highlight: Highlight;
  onAfter: () => void;
  variant: 'hero' | 'stacked';
}

export function HighlightCopyBlock({ highlight, onAfter, variant }: HighlightCopyBlockProps) {
  const isImageless = !highlight.media.src;
  const inlineBullets =
    isImageless && highlight.fallback.bullets && highlight.fallback.bullets.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-w-3xl flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {highlight.badge && (
            <Badge tone={BADGE_TONE[highlight.badge]}>{BADGE_LABEL[highlight.badge]}</Badge>
          )}
          <h3
            className={cn(
              'text-fg leading-tight font-semibold tracking-tight',
              variant === 'hero' ? 'text-[18px]' : 'text-[16px]',
            )}
          >
            {highlight.title}
          </h3>
        </div>
        <p className="text-fg-muted text-[13px] leading-relaxed">{highlight.blurb}</p>
      </div>
      {inlineBullets && <InlineBulletGrid fallback={highlight.fallback} />}
      {highlight.cta && (
        <div className="pt-1">
          <CtaButton cta={highlight.cta} onAfter={onAfter} />
        </div>
      )}
    </div>
  );
}
