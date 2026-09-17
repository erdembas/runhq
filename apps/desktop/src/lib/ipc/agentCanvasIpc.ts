import { invoke } from '@tauri-apps/api/core';

export const agentCanvasIpc = {
  agentCanvasUrl: () => invoke<string>('agent_canvas_url'),
  agentCanvasSave: (filename: string, source: string) =>
    invoke<string | null>('agent_canvas_save', { filename, source }),
};
