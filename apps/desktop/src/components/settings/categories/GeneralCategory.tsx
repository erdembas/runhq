import * as i18n from '@runhq/cockpit-ui/i18n';
import { SettingsPageShell, SettingsSection } from '../SettingsView';
import { AgentPermissionSettings } from '../AgentPermissionSettings';

export function GeneralCategory() {
  const locale = i18n.useLocale();
  return (
    <SettingsPageShell description={i18n.t('Language and agent permission preferences.')}>
      <SettingsSection
        title={i18n.t('Display language')}
        description={i18n.t(
          'Changes apply immediately to all windows. Agent responses, logs, code and your own content keep their original language.',
        )}
      >
        <select
          aria-label={i18n.t('Display language')}
          value={locale}
          onChange={(event) => i18n.setLocale(event.target.value as i18n.Locale)}
          className="border-border bg-surface-raised text-fg rounded-app-sm border px-3 py-2 text-sm"
        >
          <option value="tr" lang="tr">
            Türkçe
          </option>
          <option value="en" lang="en">
            English
          </option>
        </select>
      </SettingsSection>
      <AgentPermissionSettings />
    </SettingsPageShell>
  );
}
