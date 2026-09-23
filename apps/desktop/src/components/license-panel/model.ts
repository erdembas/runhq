import * as i18n from '@runhq/cockpit-ui/i18n/core';
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
  get safe() {
    return i18n.t('Safe');
  },
  get permissive() {
    return i18n.t('Permissive');
  },
  get weak_copyleft() {
    return i18n.t('Weak Copyleft');
  },
  get strong_copyleft() {
    return i18n.t('Strong Copyleft');
  },
  get network_copyleft() {
    return i18n.t('Network Copyleft');
  },
  get proprietary() {
    return i18n.t('Proprietary');
  },
  get unknown() {
    return i18n.t('Unknown');
  },
};
