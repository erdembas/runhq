import { invoke } from '@tauri-apps/api/core';
import type { LicenseScanResult, ServiceId } from '@/types';

export const licenseIpc = {
  scanLicenses: (id: ServiceId) => invoke<LicenseScanResult>('scan_licenses', { id }),
  generateThirdPartyNotices: (id: ServiceId) =>
    invoke<{ content: string }>('generate_third_party_notices', { id }),
  writeThirdPartyNotices: (id: ServiceId) => invoke<string>('write_third_party_notices', { id }),
};
