// Visual primitive lives in the framework-agnostic
// `@runhq/cockpit-ui` package so the marketing site renders the
// exact same SVG. This file is kept as a thin re-export so existing
// `@/components/Sparkline` imports across the desktop tree continue
// to resolve without churn.
export { Sparkline } from '@runhq/cockpit-ui';
