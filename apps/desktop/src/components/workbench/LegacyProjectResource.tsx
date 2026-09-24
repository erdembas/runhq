import * as i18n from '@runhq/cockpit-ui/i18n';
import { ArrowUpRight } from 'lucide-react';
import { openProjectSection } from '@/lib/workbenchNavigation';

/** Saved split layouts keep their positions without mounting a second workspace. */
export function LegacyProjectResource({
  serviceId,
  kind,
}: {
  serviceId: string;
  kind: 'agents' | 'docs' | 'notes';
}) {
  i18n.useLocale();
  return (
    <div className="text-fg-muted flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[13px]">
      <button
        type="button"
        className="border-border hover:bg-surface-raised text-fg flex items-center gap-2 rounded-lg border px-4 py-2"
        onClick={() => openProjectSection(serviceId, kind)}
      >
        {kind === 'agents'
          ? i18n.t('Open project tasks')
          : kind === 'docs'
            ? i18n.t('Open project documents')
            : i18n.t('Open project notes')}
        <ArrowUpRight className="h-4 w-4" />
      </button>
    </div>
  );
}
