export const MAX_UI_LOG_LINES = 5_000;

/** Sparkline window size. 60 samples at 2s = 2 minutes of history — long
 *  enough to catch a start-up CPU burst fading into steady state without
 *  bloating the store for idle services. */
export const RESOURCE_HISTORY_MAX = 60;

export function logKey(serviceId: string, cmdName: string): string {
  return `${serviceId}::${cmdName}`;
}

export * from '@/store/runtime/appStorePrefs';
export * from '@/store/runtime/appStoreSections';
export * from '@/store/runtime/appStorePanels';
