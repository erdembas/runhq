// Pure tone-classification helpers live in `@runhq/cockpit-ui` so the
// marketing site renders identical CPU / RAM tinting. Kept as a thin
// re-export so existing `@/lib/resourceTone` imports don't have to be
// rewritten.
export { cpuToneClass, memoryToneClass } from '@runhq/cockpit-ui';
