import type { AgentItem, AgentSnapshot } from '@runhq/cockpit-types';

function sameItem(left: AgentItem, right: AgentItem) {
  return (
    left.kind === right.kind &&
    left.title === right.title &&
    left.text === right.text &&
    left.status === right.status &&
    left.created_at === right.created_at
  );
}

export function mergeAgentSnapshot(previous: AgentSnapshot | null, next: AgentSnapshot) {
  if (!previous || previous.session.id !== next.session.id) return next;
  const previousItems = new Map(previous.items.map((item) => [item.id, item]));
  const latestIds = new Set(next.items.map((item) => item.id));
  const older = previous.items.filter((item) => !latestIds.has(item.id));
  const latest = next.items.map((item) => {
    const existing = previousItems.get(item.id);
    // IPC returns fresh objects even for unchanged messages. Preserve their identity so
    // streaming one message does not parse every older Markdown message again.
    return existing && sameItem(existing, item) ? existing : item;
  });
  const items = [...older, ...latest];
  const unchanged =
    items.length === previous.items.length &&
    items.every((item, index) => item === previous.items[index]);
  return {
    ...next,
    items: unchanged ? previous.items : items,
    before: older.length ? previous.before : next.before,
  };
}
