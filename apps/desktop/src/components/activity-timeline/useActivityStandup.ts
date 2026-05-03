import { useCallback, useEffect } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import { ipc } from '@/lib/ipc';

export function useActivityStandup(onCopied: () => void) {
  const buildStandupPayload = useCallback(async () => {
    try {
      const since = Date.now() - 86_400_000;
      const text = await ipc.exportStandup(since);
      if (!text.trim()) {
        console.warn('Nothing to polish — timeline is empty for the last 24h.');
        return null;
      }
      const contextSystemMessage = [
        'User is asking the AI to polish a standup note. Output exactly three sections in GitHub-flavoured Markdown: **Yesterday**, **Today**, **Blockers**. Each section: 1–4 short bullets, present tense for "Today", past tense for "Yesterday". Empty sections render as "_(none)_". Reference real project names from the raw notes. Do not invent activity. The first character of your reply must be a `#` or `**`.',
        '',
        'Raw activity (last 24h, exported from RunHQ timeline):',
        '```markdown',
        text,
        '```',
      ].join('\n');
      return {
        origin: 'standup' as const,
        title: 'Standup polish',
        context: { kind: 'standup', raw_chars: text.length },
        draftPrompt: 'Polish this into Yesterday / Today / Blockers.',
        contextSystemMessage,
        actionHook: { kind: 'insert_standup' as const },
      };
    } catch (error) {
      console.error('buildStandupPayload failed:', error);
      return null;
    }
  }, []);

  const standupHeader = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: buildStandupPayload,
  });
  const standupOverlay = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: buildStandupPayload,
  });

  useEffect(() => {
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<{ content: string }>).detail;
      if (!detail?.content?.trim()) return;
      try {
        await writeText(detail.content);
      } catch (error) {
        console.error('insert-standup clipboard write failed:', error);
      }
    };
    window.addEventListener('runhq:ai-action:insert-standup', handler);
    return () => window.removeEventListener('runhq:ai-action:insert-standup', handler);
  }, []);

  const exportStandup = useCallback(async () => {
    try {
      const since = Date.now() - 86_400_000;
      const text = await ipc.exportStandup(since);
      await writeText(text);
      onCopied();
    } catch (error) {
      console.error('Failed to export standup', error);
    }
  }, [onCopied]);

  return { exportStandup, standupHeader, standupOverlay };
}
