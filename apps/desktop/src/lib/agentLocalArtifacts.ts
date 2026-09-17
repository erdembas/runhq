/** Called only after the backend confirms that the conversation was deleted. */
export function clearAgentLocalArtifacts(
  sessionId: string,
  storage: Pick<typeof window.localStorage, 'length' | 'key' | 'removeItem'>,
): void {
  const canvasPrefix = 'runhq:agent-canvas:v1:';
  const planPrefix = `runhq:plan:${sessionId}:`;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key) continue;
    if (key.startsWith(planPrefix)) keys.push(key);
    else if (key.startsWith(canvasPrefix)) {
      try {
        const identity: unknown = JSON.parse(key.slice(canvasPrefix.length));
        if (Array.isArray(identity) && identity[0] === sessionId) keys.push(key);
      } catch {
        /* Unrelated or malformed entries must not affect session deletion. */
      }
    }
  }
  for (const key of keys) storage.removeItem(key);
}
