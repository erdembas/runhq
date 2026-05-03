import { AiProviderManager } from '@/components/AiProviderManager';
import { SettingsPageShell } from '../SettingsView';

/**
 * AI Providers landing page inside Settings.
 *
 * The provider CRUD flow (create / edit / delete forms, language
 * pickers, "Test connection" button) used to live behind a separate
 * `<Dialog>` opened from a "Manage providers" button — but that
 * indirection just added a second surface for the user to navigate.
 * Now the full management UI is rendered inline as part of the
 * Settings tab and inherits the page's scroll container, so adding
 * or editing a provider is a single landing rather than a modal hop.
 *
 * `description` is intentionally omitted: `AiProviderManager` has
 * its own intro paragraph (which lists concrete OpenAI-compatible
 * endpoints — Ollama, LM Studio, OpenRouter, …) and rendering the
 * generic shell description above it would duplicate the same
 * meta-blurb twice in the first viewport. The "Defaults &
 * overrides" tips section that used to live here was removed
 * alongside the modal: every tip pointed back at the very dialog
 * this page now hosts, so the redirection became circular the
 * moment management moved inline.
 */
export function AiCategory() {
  return (
    <SettingsPageShell>
      <AiProviderManager />
    </SettingsPageShell>
  );
}
