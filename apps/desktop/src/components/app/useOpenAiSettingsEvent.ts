import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';

export function useOpenAiSettingsEvent() {
  const openSettings = useAppStore((s) => s.openSettings);

  useEffect(() => {
    const onOpen = () => openSettings('ai');
    window.addEventListener('runhq:open-ai-settings', onOpen);
    return () => window.removeEventListener('runhq:open-ai-settings', onOpen);
  }, [openSettings]);
}
