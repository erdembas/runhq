import type { ReleaseSection } from '../../types';
import { dashboardAndDistributionSections } from './dashboard-and-distribution';
import { settingsSections } from './settings';
import { workspaceAndTerminalSections } from './workspace-and-terminal';

export const release_0_10_3_sections: ReleaseSection[] = [
  ...workspaceAndTerminalSections,
  ...settingsSections,
  ...dashboardAndDistributionSections,
];
