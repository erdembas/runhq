import { Channel, invoke } from '@tauri-apps/api/core';

export function invokeStream<TChunk, TInput>(
  command: string,
  input: TInput,
  onChunk: (chunk: TChunk) => void,
) {
  const channel = new Channel<TChunk>();
  channel.onmessage = onChunk;
  return invoke<void>(command, { input, onChunk: channel });
}
