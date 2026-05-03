import type { SidebarGroupBy, SidebarStatusFilter } from '@/store/useAppStore';

export const STATUS_OPTIONS: Array<{ key: SidebarStatusFilter; label: string; hint: string }> = [
  { key: 'all', label: 'All', hint: 'Show everything' },
  { key: 'running', label: 'Running', hint: 'Live processes only' },
  { key: 'stopped', label: 'Stopped', hint: 'Idle services only' },
];

export const GROUP_OPTIONS: Array<{ key: SidebarGroupBy; label: string }> = [
  { key: 'none', label: 'None' },
  { key: 'category', label: 'Category' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'status', label: 'Status' },
];
