import * as i18n from '@runhq/cockpit-ui/i18n';
import type { Dispatch, SetStateAction } from 'react';
import { Globe, Play, RotateCcw, Square } from 'lucide-react';
import { EditorDropdown } from '@/components/EditorDropdown';
import { GitStatusChip } from '@/components/GitStatusChip';
import { ipc } from '@/lib/ipc';
import { localUrl } from '@/lib/url';
import { useAppStore } from '@/store/useAppStore';
import type { ServiceDef } from '@/types';
import { CardAction } from './CardAction';
import { CardOverflowMenu } from './CardOverflowMenu';

interface PendingConfirm {
  message: string;
  onConfirm: () => void;
}

interface ServiceCardActionsProps {
  svc: ServiceDef;
  isRunning: boolean;
  setPendingConfirm: Dispatch<SetStateAction<PendingConfirm | null>>;
  onOpenOverlay?: (serviceId: string, kind: 'notes' | 'license') => void;
}

export function ServiceCardActions({
  svc,
  isRunning,
  setPendingConfirm,
  onOpenOverlay,
}: ServiceCardActionsProps) {
  i18n.useLocale();
  const openEditor = useAppStore((s) => s.openEditor);
  const removeServiceLocal = useAppStore((s) => s.removeService);
  const upsertService = useAppStore((s) => s.upsertService);

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {isRunning ? (
        <button
          type="button"
          title={i18n.t('Stop')}
          onClick={() => void ipc.stopService(svc.id)}
          className="bg-status-error/10 text-status-error hover:bg-status-error/20 border-status-error/25 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition"
        >
          {i18n.rich('{value1}Stop', {
            value1: <Square className="h-3 w-3" fill="currentColor" />,
          })}
        </button>
      ) : (
        <button
          type="button"
          title={i18n.t('Start')}
          onClick={() => void ipc.startService(svc.id)}
          className="bg-status-running/10 text-status-running hover:bg-status-running/20 border-status-running/25 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition"
        >
          {i18n.rich('{value1}Start', { value1: <Play className="h-3 w-3" fill="currentColor" /> })}
        </button>
      )}
      <CardAction title={i18n.t('Restart')} onClick={() => void ipc.restartService(svc.id)}>
        <RotateCcw className="h-3.5 w-3.5" />
      </CardAction>
      {svc.port != null && (
        <CardAction
          title={i18n.t('Open {value1}', { value1: localUrl(svc.port!) })}
          onClick={() => void ipc.openUrl(localUrl(svc.port!))}
          tone="accent"
        >
          <Globe className="h-3.5 w-3.5" />
        </CardAction>
      )}
      <CardOverflowMenu
        onEdit={() => openEditor(svc)}
        onOpenFolder={() => void ipc.openPath(svc.cwd)}
        onNotes={() => onOpenOverlay?.(svc.id, 'notes')}
        onLicense={() => onOpenOverlay?.(svc.id, 'license')}
        isHidden={!!svc.hide_dashboard}
        onToggleHidden={() => {
          const next = { ...svc, hide_dashboard: !svc.hide_dashboard };
          upsertService(next);
          void ipc
            .updateService(next)
            .then((saved) => upsertService(saved))
            .catch((err) => {
              console.warn('updateService(hide_dashboard) failed', err);
              upsertService(svc);
            });
        }}
        onDelete={() => {
          setPendingConfirm({
            message: i18n.t('Delete "{value1}"?', { value1: svc.name }),
            onConfirm: async () => {
              setPendingConfirm(null);
              await ipc.stopService(svc.id).catch(() => undefined);
              await ipc.removeService(svc.id);
              removeServiceLocal(svc.id);
            },
          });
        }}
      />
      <div className="ml-auto flex items-center gap-1">
        <GitStatusChip serviceId={svc.id} compact />
        <EditorDropdown cwd={svc.cwd} cmds={svc.cmds} size="xs" />
      </div>
    </div>
  );
}
