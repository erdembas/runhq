// Type definitions live in the framework-agnostic `@runhq/cockpit-types`
// package so the marketing site (apps/site) and the future shared
// presentational layer (packages/cockpit-ui) can consume the exact same
// shapes the desktop app uses, without dragging in any Tauri / Zustand /
// IPC code. Existing call sites keep importing from `@/types` — this
// barrel just forwards to the package.
export * from '@runhq/cockpit-types';
