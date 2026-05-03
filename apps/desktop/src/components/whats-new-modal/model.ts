import type { BadgeTone } from '@/components/ui/Badge';
import { useAppStore } from '@/store/useAppStore';
import type { Highlight, HighlightFallback, WhatsNewActionId } from '@/lib/whatsnew';

export const TINT_GRADIENT: Record<HighlightFallback['tint'], string> = {
  accent:
    'radial-gradient(at 25% 25%, rgb(var(--accent) / 0.55), transparent 60%), radial-gradient(at 80% 80%, rgb(var(--accent) / 0.30), transparent 65%)',
  sky: 'radial-gradient(at 25% 25%, rgb(56 189 248 / 0.45), transparent 60%), radial-gradient(at 80% 80%, rgb(14 165 233 / 0.30), transparent 65%)',
  violet:
    'radial-gradient(at 25% 25%, rgb(167 139 250 / 0.45), transparent 60%), radial-gradient(at 80% 80%, rgb(139 92 246 / 0.30), transparent 65%)',
  emerald:
    'radial-gradient(at 25% 25%, rgb(110 231 183 / 0.45), transparent 60%), radial-gradient(at 80% 80%, rgb(52 211 153 / 0.30), transparent 65%)',
  amber:
    'radial-gradient(at 25% 25%, rgb(252 211 77 / 0.45), transparent 60%), radial-gradient(at 80% 80%, rgb(245 158 11 / 0.30), transparent 65%)',
};

export const ASPECT_CLASS: Record<Highlight['media']['aspectRatio'], string> = {
  '16/9': 'aspect-video',
  '4/3': 'aspect-[4/3]',
  '1/1': 'aspect-square',
};

export const BADGE_TONE: Record<NonNullable<Highlight['badge']>, BadgeTone> = {
  new: 'accent',
  improved: 'info',
  fix: 'success',
};

export const BADGE_LABEL: Record<NonNullable<Highlight['badge']>, string> = {
  new: 'New',
  improved: 'Improved',
  fix: 'Fixed',
};

export function runModalStoreAction(actionId: WhatsNewActionId, onClose: () => void): void {
  const store = useAppStore.getState();
  switch (actionId) {
    case 'open-overview':
      store.setSelected(null);
      store.setSelectedStack(null);
      onClose();
      return;
    case 'open-cross-project-diff':
      store.openCrossProjectDiff();
      onClose();
      return;
    case 'open-timeline':
      store.openTimeline();
      onClose();
      return;
    case 'open-ai-chat':
      store.setRightPanel('ai');
      store.setActiveConversation(null);
      onClose();
      return;
    case 'open-ai-settings':
      onClose();
      window.dispatchEvent(new CustomEvent('runhq:open-ai-settings'));
      return;
    case 'open-changelog':
      return;
  }
}

export function formatReleaseDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return iso;
  }
}
