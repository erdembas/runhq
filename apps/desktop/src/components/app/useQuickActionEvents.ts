import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '@/store/useAppStore';
import { useShellUiStore } from '@/store/useShellUiStore';

type StartScan = () => Promise<void> | void;

export function useQuickActionEvents(startScan: StartScan) {
  const setSelected = useAppStore((s) => s.setSelected);
  const openServiceWithBodyTab = useAppStore((s) => s.openServiceWithBodyTab);
  const openEditor = useAppStore((s) => s.openEditor);
  const openStackEditor = useAppStore((s) => s.openStackEditor);
  const openSettings = useAppStore((s) => s.openSettings);
  const setPaletteOpen = useShellUiStore((s) => s.setPaletteOpen);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    void (async () => {
      unsubs.push(await listen('runhq://palette-opened', () => setPaletteOpen(true)));
      unsubs.push(await listen('runhq://palette-closed', () => setPaletteOpen(false)));
      unsubs.push(
        await listen<{ serviceId: string; openTerminal?: boolean }>(
          'quick-action://navigate',
          (event) => {
            if (event.payload.openTerminal) {
              openServiceWithBodyTab(event.payload.serviceId, 'terminal');
            } else {
              setSelected(event.payload.serviceId);
            }
          },
        ),
      );
      unsubs.push(await listen('quick-action://scan', () => startScan()));
      unsubs.push(await listen('quick-action://shortcuts', () => openSettings('shortcuts')));
      unsubs.push(
        await listen<string>('runhq://tray-action', (event) => {
          switch (event.payload) {
            case 'new-service':
              openEditor(null);
              break;
            case 'new-stack':
              openStackEditor(null);
              break;
            case 'scan':
              startScan();
              break;
          }
        }),
      );
    })();

    return () => unsubs.forEach((unsub) => unsub());
  }, [
    openEditor,
    openServiceWithBodyTab,
    openSettings,
    openStackEditor,
    setPaletteOpen,
    setSelected,
    startScan,
  ]);
}
