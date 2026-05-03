export const WIDE_PREF_KEY = 'runhq.notes.wideLayout';

export function readWidePref(): boolean {
  try {
    return window.localStorage.getItem(WIDE_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeWidePref(wide: boolean): void {
  try {
    window.localStorage.setItem(WIDE_PREF_KEY, wide ? '1' : '0');
  } catch {
    // ignore
  }
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

export function cssEscape(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/[^\w-]/g, '\\$&');
}

export function formatRelativeMs(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}
