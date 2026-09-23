# Working on RunHQ

Preserve existing work in the checkout. This monorepo contains the Tauri desktop app,
the shared React UI, the marketing site and the Rust/runtime packages.

## Internationalization is mandatory

Every new or changed **RunHQ-owned, user-visible desktop string must support English
and Turkish in the same change**. i18n is a requirement, not follow-up work.

- Use the typed catalog in `packages/cockpit-ui/src/i18n/en.json` and `tr.json`.
  Add both translations before using a new key. English source messages are keys;
  give placeholders meaningful names. Reuse a key only when its meaning is the same.
- React UI imports `@runhq/cockpit-ui/i18n`; pure helpers import its `/core` entry.
  Shared-package code uses the corresponding relative import. Subscribe with
  `i18n.useLocale()` in components. For memoized translated data, import
  `useLocaleMemo as useMemo` from i18n so changing language invalidates cached labels.
- Translate whole sentences using `t` or `rich` and named placeholders. Do not join
  translated sentence fragments or add English plural suffixes in new code. Use
  `plural` for count-dependent wording. Rich placeholders preserve React markup
  without injecting HTML.
- Cover labels, descriptions, help text, empty/loading/error states, confirmations,
  notifications, context menus, accessibility text and native desktop menus/dialogs.
  Use `number`, `date`, `relative`, or `getFormatLocale()` for locale-aware formatting.
- Module-level display tables must resolve translations lazily (e.g. property getters
  or a factory called during rendering); never freeze a translated label at import time.
  Never call React hooks while building these tables, including inside `map`/`reduce`
  callbacks. Subscribe in the consuming component; keep data helpers on the `/core` entry.
- **Do not translate agent/provider responses or supplied question/choice labels,
  user-written content, project/file names, code, logs, protocol values, IDs, commands,
  model IDs or stored data.** Translate our surrounding UI only. Interface language
  and the independently configured AI response/commit languages are separate settings.
- Language switches must preserve drafts, open tabs and running processes. Do not
  remount the application to change language. Keep main/quick-action/tray windows in sync.
- Native UI uses the same catalog through `tray::localize`. Keep technical diagnostics
  intact; present any app-owned explanatory text through translated UI.
- Historical release-note content and the marketing site are outside the current
  desktop migration; shared components still default to English unless initialized.

Run `pnpm i18n:check` and `pnpm i18n:test` for translation changes, plus relevant
existing tests, typechecks and builds. The check rejects missing translations,
invalid placeholders and uncatalogued UI literals. Any narrow exemption must explain
why the text is technical, user/provider content, or outside the desktop scope.
Never add an exemption merely to avoid translating a new label.

Before shipping desktop changes, open the full production app and verify that the
main window renders. A successful build or an isolated component preview does not
verify startup of the complete module graph.
