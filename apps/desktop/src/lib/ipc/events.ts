import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { LogEvent, ResourceEvent, ServiceStatus } from '@/types';

export const events = {
  onStatus: (handler: (status: ServiceStatus) => void): Promise<UnlistenFn> =>
    listen<ServiceStatus>('service://status', (e) => handler(e.payload)),
  onLog: (handler: (ev: LogEvent) => void): Promise<UnlistenFn> =>
    listen<LogEvent>('service://log', (e) => handler(e.payload)),
  onResources: (handler: (ev: ResourceEvent) => void): Promise<UnlistenFn> =>
    listen<ResourceEvent>('service://resources', (e) => handler(e.payload)),
};
