import * as i18n from '@runhq/cockpit-ui/i18n/core';
export function timeAgo(ts: number): string {
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - ts);
  if (diff < 60) return i18n.t('{value1}s ago', { value1: Math.floor(diff) });
  if (diff < 3600) return i18n.t('{value1}m ago', { value1: Math.floor(diff / 60) });
  if (diff < 86400) return i18n.t('{value1}h ago', { value1: Math.floor(diff / 3600) });
  if (diff < 86400 * 30) return i18n.t('{value1}d ago', { value1: Math.floor(diff / 86400) });
  if (diff < 86400 * 365)
    return i18n.t('{value1}mo ago', { value1: Math.floor(diff / (86400 * 30)) });
  return i18n.t('{value1}y ago', { value1: Math.floor(diff / (86400 * 365)) });
}

export function authorHue(author: string): number {
  let h = 0;
  for (let i = 0; i < author.length; i++) {
    h = (h * 31 + author.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

export function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}
