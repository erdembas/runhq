// Visual primitive lives in `@runhq/cockpit-ui` so the marketing
// site renders the exact same git chip surface. The full
// `GitStatusChip` (popover with branch list, recent commits, IPC
// actions) stays in this folder because every action is a Tauri
// round-trip; only the trigger is shared.
export { GitStatusTrigger } from '@runhq/cockpit-ui';
