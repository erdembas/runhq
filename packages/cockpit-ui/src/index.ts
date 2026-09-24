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
export { matchesMessageSendShortcut } from './lib/messageSendShortcut';
export type { MessageSendShortcut } from './lib/messageSendShortcut';
export { formatBytes, formatPercent } from './lib/format';
export { cpuToneClass, memoryToneClass } from './lib/resourceTone';
export { AgentStatusBadge } from './components/AgentStatusBadge';
export { AgentActivityBadge } from './components/AgentActivityBadge';
export { AgentNotificationSettings } from './components/AgentNotificationSettings';
export { summarizeAgentActivity, agentActivityLabel } from './lib/agentActivity';
export type { AgentActivitySummary } from './lib/agentActivity';
export {
  validateAgentAttachments,
  agentSupportsImages,
  MAX_AGENT_ATTACHMENTS,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_BASE64_LENGTH,
  AGENT_IMAGE_MIME_TYPES,
} from './lib/agentAttachments';
export { AGENT_STATUS_LABELS, agentIsActive } from './components/agentStatus';
export { AgentRequestCard } from './components/AgentRequestCard';
export { AgentComposer } from './components/AgentComposer';
export { AgentProviderLogo } from './components/AgentProviderLogo';
export { AgentProviderPicker } from './components/AgentProviderPicker';
export { AgentModelControls } from './components/AgentModelControls';
export { agentProviderNames } from './components/agentProviders';
export { SearchableSelect } from './components/SearchableSelect';
export type { SearchableOption } from './lib/selectSearch';
export { WorkspaceGroupHeader } from './components/WorkspaceGroupHeader';

export { AgentEffortPicker } from './components/AgentEffortPicker';
export { AgentTaskSettings } from './components/AgentTaskSettings';
export { AgentMessageQueue } from './components/AgentMessageQueue';
export { AgentPlanReview } from './components/AgentPlanReview';
export { collectAgentPlans, agentPlanDocument, buildAgentPlanPrompt } from './lib/agentPlans';
export type { AgentPlanDocument, AgentPlanStep } from './lib/agentPlans';
export { AgentCanvas } from './components/AgentCanvas';
export type { AgentCanvasProps } from './components/AgentCanvas';
export {
  extractAgentCanvasArtifacts,
  agentCanvasStorageKey,
  readAgentCanvasEdit,
  buildAgentCanvasDocument,
  agentCanvasDownloadName,
} from './lib/agentCanvas';
export type { AgentCanvasArtifact, AgentCanvasKind } from './lib/agentCanvas';
export { AgentMissionControl } from './components/AgentMissionControl';
export { AgentTaskTemplates } from './components/AgentTaskTemplates';
export { AGENT_TASK_TEMPLATES } from './lib/agentTaskTemplates';
export type { AgentTaskTemplate } from './components/AgentTaskTemplates';
export { agentTaskLane, groupAgentTasks } from './lib/agentMissionControl';
export type { AgentTaskLane } from './lib/agentMissionControl';
export { AgentConnectionStatus, AgentProviderChips } from './components/AgentConnectionStatus';
export {
  agentDetectionStatus,
  enabledAgentBackends,
  chooseAgentBackend,
  agentConnectionState,
} from './lib/agentDiscovery';
export type { AgentConnectionState } from './lib/agentDiscovery';
export {
  AgentDiscoverySummary,
  AgentToolDetectionBadge,
  AgentToolDetectionDetails,
} from './components/AgentToolDiscovery';
