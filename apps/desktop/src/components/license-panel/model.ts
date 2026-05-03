import type { LicenseRisk } from '@/types';

/**
 * Risk tone palette. Keys are `snake_case` so they line up byte-for-byte
 * with the wire format coming out of the Rust `LicenseRisk` enum
 * (`#[serde(rename_all = "snake_case")]`). If you ever see a row
 * silently render with neutral styling, the first thing to check is
 * whether the backend is still emitting the rename.
 */
export const RISK_TONE: Record<
  LicenseRisk,
  'critical' | 'warning' | 'success' | 'neutral' | 'info'
> = {
  safe: 'success',
  permissive: 'success',
  weak_copyleft: 'warning',
  strong_copyleft: 'critical',
  network_copyleft: 'critical',
  proprietary: 'warning',
  unknown: 'neutral',
};

export const RISK_LABEL: Record<LicenseRisk, string> = {
  safe: 'Safe',
  permissive: 'Permissive',
  weak_copyleft: 'Weak Copyleft',
  strong_copyleft: 'Strong Copyleft',
  network_copyleft: 'Network Copyleft',
  proprietary: 'Proprietary',
  unknown: 'Unknown',
};
