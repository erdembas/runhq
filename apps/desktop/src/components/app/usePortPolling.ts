import { useEffect } from 'react';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';

export function usePortPolling() {
  const setPorts = useAppStore((s) => s.setPorts);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const ports = await ipc.listPorts();
        if (alive) setPorts(ports);
      } catch (err) {
        console.error('list_ports failed', err);
      }
    };

    void poll();
    const id = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setPorts]);
}
