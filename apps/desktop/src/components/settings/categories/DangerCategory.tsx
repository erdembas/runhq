import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { SettingsPageShell, SettingsSection } from '../SettingsView';

/**
 * Destructive operations live on their own page so they can't be
 * mistaken for everyday preferences. The page wears a single
 * warning banner at the top so the user re-confirms intent before
 * scrolling, and every destructive action requires a typed-confirm
 * dialog before firing.
 */
export function DangerCategory({ description }: { description?: string }) {
  i18n.useLocale();
  return (
    <SettingsPageShell description={description}>
      {/*
        Destructive frame: solid `status-error` border + leading 4px
        accent bar + tinted background + halo ring. Three independent
        signals — frame, bar, tint — so no single one carries the
        load and the banner stays legible even on Retina sub-pixel
        rendering where alpha-thin borders smudge.

        IMPORTANT — colour-token convention: the codebase's
        red/destructive colour lives under `status-error` (matches
        the `Button variant="danger"` definition). Earlier drafts
        of this component used `*-danger` Tailwind classes which
        Tailwind v4 silently dropped because there's no
        `--color-danger` token defined — the banner border was
        invisible until we migrated to the right token name.
      */}
      <div className="border-status-error bg-status-error/10 ring-status-error/20 rounded-app-sm mb-5 flex items-start gap-3 border p-3">
        <AlertTriangle className="text-status-error mt-0.5 h-4 w-4 shrink-0" />
        <div className="text-fg text-[11px] leading-relaxed">
          {i18n.rich(
            '{value1} Make sure you have a backup of your config directory (see Data & Cache → Storage location) before running any operation here.',
            {
              value1: (
                <strong className="text-status-error">
                  {i18n.t('These actions cannot be undone.')}
                </strong>
              ),
            },
          )}
        </div>
      </div>

      <SettingsSection
        title={i18n.t('Workspace reset')}
        description={i18n.t(
          'Remove every service, stack, and section from this workspace. The underlying project directories on disk are untouched — only the RunHQ workspace state is wiped.',
        )}
      >
        <FullReset />
      </SettingsSection>
    </SettingsPageShell>
  );
}

function FullReset() {
  i18n.useLocale();
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const services = useAppStore((s) => s.services);
  const setServices = useAppStore((s) => s.setServices);
  const setStacks = useAppStore((s) => s.setStacks);

  const resetSections = useCallback(() => {
    useAppStore.setState({ sections: [], serviceSection: {}, stackSection: {} });
  }, []);

  const doReset = async () => {
    setBusy(true);
    for (const svc of services) {
      await ipc.stopService(svc.id).catch(() => {});
      await ipc.removeService(svc.id);
    }
    setServices([]);
    setStacks([]);
    resetSections();
    setBusy(false);
    setPending(false);
  };

  return (
    <>
      <div className="border-border/50 bg-surface/40 rounded-app-sm flex items-center justify-between gap-3 border px-3 py-3">
        <div className="text-fg-dim text-[11px]">
          {services.length === 0
            ? i18n.t('No services to remove.')
            : i18n.t('{value1} service{plural2} will be removed.', {
                value1: services.length,
                plural2: services.length === 1 ? '' : 's',
              })}
        </div>
        <Button
          variant="danger"
          size="sm"
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => setPending(true)}
          disabled={services.length === 0 || busy}
        >
          {busy ? i18n.t('Resetting…') : i18n.t('Full Reset')}
        </Button>
      </div>
      {pending && (
        <ConfirmDialog
          message={i18n.t('Delete all services, stacks, and sections?')}
          onConfirm={doReset}
          onCancel={() => setPending(false)}
        />
      )}
    </>
  );
}
