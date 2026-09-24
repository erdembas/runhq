export type MessageSendShortcut = 'Enter' | 'CmdOrCtrl+Enter';

/** Focused composers handle this shortcut; IME confirmation and line breaks stay local. */
export function matchesMessageSendShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'keyCode'
  >,
  shortcut: MessageSendShortcut = 'Enter',
) {
  return (
    event.key === 'Enter' &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.shiftKey &&
    !event.altKey &&
    (shortcut === 'Enter' || event.metaKey || event.ctrlKey)
  );
}
