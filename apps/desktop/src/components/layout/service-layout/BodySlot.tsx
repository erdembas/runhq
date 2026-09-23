import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback } from 'react';
import { cn } from '@/lib/cn';

interface BodySlotProps {
  tabId: string;
  active: boolean;
  onSlotRef: (tabId: string, el: HTMLDivElement | null) => void;
}

export function BodySlot({ tabId, active, onSlotRef }: BodySlotProps) {
  i18n.useLocale();
  const setRef = useCallback(
    (el: HTMLDivElement | null) => onSlotRef(tabId, el),
    [tabId, onSlotRef],
  );
  return (
    <div
      ref={setRef}
      data-tab-slot={tabId}
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col',
        !active && 'pointer-events-none invisible',
      )}
    />
  );
}
