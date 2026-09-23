import * as i18n from '@runhq/cockpit-ui/i18n/core';
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

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024)
    return `${i18n.number(n / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} KB`;
  return i18n.t('{value1} MB', {
    value1: i18n.number(n / (1024 * 1024), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
    }),
  });
}

export function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return i18n.t('just now');
  if (diff < 3_600_000) return i18n.t('{value1}m ago', { value1: Math.round(diff / 60_000) });
  if (diff < 86_400_000) return i18n.t('{value1}h ago', { value1: Math.round(diff / 3_600_000) });
  if (diff < 30 * 86_400_000)
    return i18n.t('{value1}d ago', { value1: Math.round(diff / 86_400_000) });
  return new Date(ms).toLocaleDateString(i18n.getFormatLocale());
}

export function resolveDocLink(baseDir: string, href: string): string {
  const cleaned = href.split('#')[0]!.split('?')[0]!;
  if (cleaned.startsWith('/')) return cleaned.replace(/^\/+/, '');
  if (!baseDir) return cleaned.replace(/^\.\//, '');
  return joinForward(baseDir, cleaned);
}

function joinForward(base: string, rel: string): string {
  const parts = base.split('/').filter(Boolean);
  const segs = rel.split('/');
  for (const s of segs) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      parts.pop();
    } else {
      parts.push(s);
    }
  }
  return parts.join('/');
}
