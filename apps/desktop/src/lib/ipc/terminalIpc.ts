import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { Channel, invoke } from '@tauri-apps/api/core';
import type { TerminalOutput } from '@/types';

// React cleanup cannot await IPC. Order create/destroy per terminal so an
// older cleanup cannot kill a newly restarted shell. Other terminals proceed
// independently, and a blocked input write never delays destruction.
const lifecycles = new Map<string, Promise<void>>();
const writes = new Map<string, Promise<void>>();
const generations = new Map<string, string>();

function enqueue(
  queue: Map<string, Promise<void>>,
  id: string,
  operation: () => Promise<void>,
): Promise<void> {
  const result = (queue.get(id) ?? Promise.resolve()).then(operation);
  const settled = result.catch(() => undefined);
  queue.set(id, settled);
  void settled.then(() => {
    if (queue.get(id) === settled) queue.delete(id);
  });
  return result;
}

export const terminalIpc = {
  terminalCreate: (
    id: string,
    cwd: string,
    cols: number,
    rows: number,
    onOutput: (chunk: TerminalOutput) => void,
    toolId?: string,
  ) => {
    const streamId = crypto.randomUUID();
    generations.set(id, streamId);
    writes.delete(id);
    const channel = new Channel<TerminalOutput>();
    channel.onmessage = onOutput;
    return enqueue(lifecycles, id, () =>
      invoke<void>('terminal_create', {
        id,
        streamId,
        cwd,
        cols,
        rows,
        onOutput: channel,
        toolId: toolId ?? null,
      }),
    );
  },
  terminalWrite: (id: string, data: number[]) => {
    const generation = generations.get(id);
    const ready = lifecycles.get(id) ?? Promise.resolve();
    return enqueue(writes, id, async () => {
      await ready;
      // Keep input ordered, but stop sending a paste as soon as its shell closes.
      for (let offset = 0; offset < data.length; offset += 4096) {
        if (!generation || generations.get(id) !== generation) {
          throw new Error(i18n.t('Terminal is restarting'));
        }
        await invoke<void>('terminal_write', {
          id,
          streamId: generation,
          data: data.slice(offset, offset + 4096),
        });
      }
    });
  },
  terminalResize: (id: string, cols: number, rows: number) =>
    invoke<void>('terminal_resize', { id, streamId: generations.get(id), cols, rows }),
  terminalAcknowledge: (id: string, streamId: string, bytes: number) =>
    invoke<void>('terminal_acknowledge', { id, streamId, bytes }),
  terminalDestroy: (id: string) => {
    generations.delete(id);
    writes.delete(id);
    return enqueue(lifecycles, id, () => invoke<void>('terminal_destroy', { id }));
  },
};
