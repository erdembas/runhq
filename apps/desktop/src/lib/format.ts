// Pure formatting helpers live in `@runhq/cockpit-ui` so the
// marketing site renders identical CPU / RAM strings. Kept as a thin
// re-export so existing `@/lib/format` imports across the desktop
// tree don't have to be rewritten.
export { formatBytes, formatPercent } from '@runhq/cockpit-ui';
