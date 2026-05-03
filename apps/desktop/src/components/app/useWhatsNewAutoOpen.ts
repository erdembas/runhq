import { useEffect } from 'react';
import { hasSeenTour } from '@/lib/onboarding';
import { getLatestRelease, shouldAutoShow } from '@/lib/whatsnew';
import { useAppStore } from '@/store/useAppStore';
import { useShellUiStore } from '@/store/useShellUiStore';

export function useWhatsNewAutoOpen() {
  const appVersion = useAppStore((s) => s.appVersion);
  const openWhatsNew = useAppStore((s) => s.openWhatsNew);
  const tourOpen = useShellUiStore((s) => s.tourState.open);

  useEffect(() => {
    if (!appVersion || tourOpen || !hasSeenTour()) return;

    const release = shouldAutoShow(appVersion, getLatestRelease());
    if (!release) return;

    const id = window.setTimeout(() => {
      openWhatsNew(release.version);
    }, 600);
    return () => window.clearTimeout(id);
  }, [appVersion, openWhatsNew, tourOpen]);
}
