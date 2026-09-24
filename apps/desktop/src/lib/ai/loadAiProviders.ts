import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import { cliChatProviders } from '@/components/ai/chat-panel/aiChatProviders';

export async function loadAiProviders() {
  const [apiResult] = await Promise.allSettled([
    ipc.listAiProviders(),
    useAgentStore.getState().refreshTools(),
  ]);
  return [
    ...(apiResult.status === 'fulfilled' ? apiResult.value : []),
    ...cliChatProviders(useAgentStore.getState().tools),
  ];
}
