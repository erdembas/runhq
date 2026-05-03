import type { ConversationSummary } from '@/types';

export function groupConversations(items: ConversationSummary[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const pinned: ConversationSummary[] = [];
  const favorites: ConversationSummary[] = [];
  const today: ConversationSummary[] = [];
  const yesterday: ConversationSummary[] = [];
  const older: ConversationSummary[] = [];

  for (const it of items) {
    if (it.pinned) pinned.push(it);
    else if (it.favorite) favorites.push(it);
    else if (it.updated_at_ms >= startOfToday) today.push(it);
    else if (it.updated_at_ms >= startOfYesterday) yesterday.push(it);
    else older.push(it);
  }
  return { pinned, favorites, today, yesterday, older };
}

export function formatRelative(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}
