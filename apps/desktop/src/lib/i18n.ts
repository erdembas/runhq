import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import {
  getLocale,
  initializeLocale,
  setLocale,
  subscribe,
  t,
  type Locale,
  type MessageKey,
} from '@runhq/cockpit-ui/i18n/core';

const EVENT = 'runhq://locale-changed';
let started = false;
/** Storage sync covers browser previews; Tauri events also cover isolated webview stores. */
export function initializeDesktopLocale(windowTitle?: MessageKey) {
  if (started) return;
  started = true;
  const stopStorage = initializeLocale();
  let receiving = false;
  let stopped = false;
  let stopEvents: (() => void) | undefined;
  const syncNative = () => {
    if (windowTitle) document.title = t(windowTitle);
    if (isTauri())
      void invoke('set_interface_locale', { locale: getLocale() }).catch(console.error);
  };
  syncNative();
  const unsubscribe = subscribe(() => {
    syncNative();
    if (isTauri() && !receiving) void emit(EVENT, getLocale()).catch(console.error);
  });
  if (isTauri()) {
    void listen<Locale>(EVENT, ({ payload }) => {
      if (payload !== 'en' && payload !== 'tr') return;
      receiving = true;
      setLocale(payload);
      receiving = false;
    })
      .then((dispose) => {
        if (stopped) dispose();
        else stopEvents = dispose;
      })
      .catch(console.error);
  }
  import.meta.hot?.dispose(() => {
    stopped = true;
    unsubscribe();
    stopStorage();
    stopEvents?.();
    started = false;
  });
}
