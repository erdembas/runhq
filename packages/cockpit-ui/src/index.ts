// Primitives — pure, presentational, shared with apps/desktop.
export { Sparkline } from './components/Sparkline';
export { StatusDot, StatusPill } from './components/StatusDot';
export { ResourceBadge } from './components/ResourceBadge';
export { GitStatusTrigger } from './components/GitStatusTrigger';

// Composites — marketing-grade. Visually mirror their apps/desktop
// counterparts but skip the live machinery (Zustand, IPC, dnd-kit,
// virtualization). When the desktop equivalents are refactored to a
// prop-driven shape, the desktop versions can be deleted in favour of
// these.
export { CockpitChrome } from './components/CockpitChrome';
export { WorkspaceSidebar } from './components/WorkspaceSidebar';
export type { SidebarStackItem, SidebarSection } from './components/WorkspaceSidebar';
export { ServiceCard } from './components/ServiceCard';
export { LogTerminalMock } from './components/LogTerminalMock';
export type { LogLineFixture } from './components/LogTerminalMock';
export { ActivityTimeline } from './components/ActivityTimeline';
export { AiPromptMock } from './components/AiPromptMock';

// Full-fidelity dashboard mock and its building blocks. These ship
// the visual shell users see after `runhq` launches — title bar, tab
// strip, sidebar, body, and status bar — composed into a single
// prop-driven `<DesktopDashboard />` for the marketing surface.
export { DesktopDashboard } from './components/DesktopDashboard';
export type { DesktopDashboardSection } from './components/DesktopDashboard';
export { TitleBar } from './components/TitleBar';
export { MainTabBar } from './components/MainTabBar';
export type { MainTab } from './components/MainTabBar';
export { StatusBar } from './components/StatusBar';
export { RightActivityRail } from './components/RightActivityRail';
export { DashboardHeader } from './components/DashboardHeader';
export { DashboardServiceCard } from './components/DashboardServiceCard';
export { RunningHotPanel } from './components/RunningHotPanel';
export type { RunningHotRow } from './components/RunningHotPanel';
export { RuntimeBadge } from './components/RuntimeBadge';
export type { RuntimeBadgeKey } from './components/RuntimeBadge';

// Phase-0 smoke export, kept for the apps/site bootstrap page.
export { HelloCockpit } from './HelloCockpit';

// Pure utility helpers re-exported for consumers that want to format a
// number outside of the components above (e.g. status bar totals on
// the marketing site).
export { cn } from './lib/cn';
export { formatBytes, formatPercent } from './lib/format';
export { cpuToneClass, memoryToneClass } from './lib/resourceTone';
