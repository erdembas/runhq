import { Channel, invoke } from '@tauri-apps/api/core';
import type { TerminalOutput } from '@/types';

export const terminalIpc = {
  terminalCreate: (
    id: string,
    cwd: string,
    cols: number,
    rows: number,
    onOutput: (chunk: TerminalOutput) => void,
  ) => {
    const channel = new Channel<TerminalOutput>();
    channel.onmessage = onOutput;
    return invoke<void>('terminal_create', { id, cwd, cols, rows, onOutput: channel });
  },
  terminalWrite: (id: string, data: number[]) => invoke<void>('terminal_write', { id, data }),
  terminalResize: (id: string, cols: number, rows: number) =>
    invoke<void>('terminal_resize', { id, cols, rows }),
  terminalDestroy: (id: string) => invoke<void>('terminal_destroy', { id }),
};
