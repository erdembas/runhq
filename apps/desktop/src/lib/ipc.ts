import { aiIpc } from './ipc/aiIpc';
import { conversationIpc } from './ipc/conversationIpc';
import { docsIpc } from './ipc/docsIpc';
import { gitIpc } from './ipc/gitIpc';
import { licenseIpc } from './ipc/licenseIpc';
import { notesIpc } from './ipc/notesIpc';
import { overviewIpc } from './ipc/overviewIpc';
import { serviceIpc } from './ipc/serviceIpc';
import { terminalIpc } from './ipc/terminalIpc';
import { timelineIpc } from './ipc/timelineIpc';
export { events } from './ipc/events';

/**
 * Typed Tauri IPC surface.
 *
 * This remains the single frontend entry point for backend calls.
 * Domain modules keep the file readable while preserving the public
 * `ipc.methodName(...)` contract used throughout the app.
 */
export const ipc = {
  ...serviceIpc,
  ...terminalIpc,
  ...gitIpc,
  ...overviewIpc,
  ...timelineIpc,
  ...conversationIpc,
  ...aiIpc,
  ...notesIpc,
  ...docsIpc,
  ...licenseIpc,
};
