import { invoke } from '@tauri-apps/api/core';
import type {
  DependencyScanEntry,
  DependencyScanResult,
  OverviewSummary,
  PersistedScan,
  ServiceId,
} from '@/types';

export const overviewIpc = {
  getProjectOverview: (staleThresholdDays?: number) =>
    invoke<OverviewSummary>('get_project_overview', {
      staleThresholdDays: staleThresholdDays ?? 30,
    }),
  scanProjectDependencies: (force = false) =>
    invoke<DependencyScanResult>('scan_project_dependencies', { force }),
  scanProjectDependencyForService: (serviceId: ServiceId, force = true) =>
    invoke<DependencyScanEntry>('scan_project_dependency_for_service', { serviceId, force }),
  listPersistedScans: () => invoke<PersistedScan[]>('list_persisted_scans'),
  deletePersistedScan: (serviceId: ServiceId) =>
    invoke<void>('delete_persisted_scan', { serviceId }),
  clearPersistedScans: () => invoke<number>('clear_persisted_scans'),
};
