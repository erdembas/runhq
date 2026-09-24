import * as i18n from '@runhq/cockpit-ui/i18n';
import type { MessageSendShortcut } from '@runhq/cockpit-ui';
import { useShellUiStore } from '@/store/useShellUiStore';

export function useMessageSendShortcut() {
  i18n.useLocale();
  const saved = useShellUiStore((state) => state.viewShortcuts?.send_message);
  const sendShortcut: MessageSendShortcut = saved === 'CmdOrCtrl+Enter' ? saved : 'Enter';
  return {
    sendShortcut,
    title: sendShortcut === 'Enter' ? i18n.t('Send · Enter') : i18n.t('Send · ⌘ / Ctrl + Enter'),
    hint:
      sendShortcut === 'Enter'
        ? i18n.t('Enter to send · Shift+Enter for a new line')
        : i18n.t('⌘ / Ctrl + Enter to send · Enter for a new line'),
  };
}
