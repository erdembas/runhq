import { useEffect, useMemo } from 'react';
import { DocumentSlimModal } from '@/components/whats-new-modal/DocumentSlimModal';
import { LegacyCarouselModal } from '@/components/whats-new-modal/LegacyCarouselModal';
import { getReleaseFor, markVersionSeen } from '@/lib/whatsnew';
import { useAppStore } from '@/store/useAppStore';
import type { WhatsNewRelease } from '@/lib/whatsnew';

interface Props {
  version: string;
  onClose: () => void;
}

export function WhatsNewModal({ version, onClose }: Props) {
  const release = useMemo<WhatsNewRelease | null>(() => getReleaseFor(version), [version]);
  const appVersion = useAppStore((s) => s.appVersion);

  useEffect(() => {
    if (appVersion) markVersionSeen(appVersion);
  }, [appVersion]);

  if (release?.kind === 'document') {
    return <DocumentSlimModal release={release} onClose={onClose} />;
  }

  return <LegacyCarouselModal release={release} onClose={onClose} />;
}
