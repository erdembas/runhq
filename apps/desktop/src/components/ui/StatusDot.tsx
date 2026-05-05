// Visual primitive lives in `@runhq/cockpit-ui` so the marketing
// site renders the exact same status indicator. Kept as a thin
// re-export so existing `@/components/ui/StatusDot` imports across
// the desktop tree don't have to be rewritten.
export { StatusDot, StatusPill } from '@runhq/cockpit-ui';
