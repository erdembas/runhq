/** Layout tab ids are local to a project; PTY ids are global to the desktop. */
export function projectTerminalId(serviceId: string, tabId: string): string {
  return `project:${encodeURIComponent(serviceId)}:${encodeURIComponent(tabId)}`;
}

/** Commands wait for the mounted PTY, including its first creation or restart. */
export function createProjectCommandQueue(write: (id: string, command: string) => Promise<void>) {
  const ready = new Set<string>();
  const pending = new Map<string, string[]>();
  const flushing = new Set<string>();
  let onError = (_error: unknown) => {};

  async function flush(id: string) {
    if (!ready.has(id) || flushing.has(id)) return;
    flushing.add(id);
    try {
      while (ready.has(id) && pending.get(id)?.length) {
        const command = pending.get(id)!.shift()!;
        try {
          await write(id, command);
        } catch (error) {
          onError(error);
        }
      }
      if (pending.get(id)?.length === 0) pending.delete(id);
    } finally {
      flushing.delete(id);
    }
  }

  return {
    onError(handler: (error: unknown) => void) {
      onError = handler;
    },
    enqueue(id: string, command: string) {
      pending.set(id, [...(pending.get(id) ?? []), command]);
      void flush(id);
    },
    ready(id: string) {
      ready.add(id);
      void flush(id);
    },
    closed(id: string) {
      ready.delete(id);
      pending.delete(id);
    },
  };
}
