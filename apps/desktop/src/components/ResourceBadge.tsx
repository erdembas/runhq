// Visual primitive lives in `@runhq/cockpit-ui` so the marketing
// site renders the exact same CPU + RAM pill. Kept as a thin
// re-export so existing `@/components/ResourceBadge` imports
// across the desktop tree don't have to be rewritten.
export { ResourceBadge } from '@runhq/cockpit-ui';
