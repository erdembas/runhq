import { useEffect } from 'react';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';

export function useAppDataBootstrap() {
  const setServices = useAppStore((s) => s.setServices);
  const setAppMeta = useAppStore((s) => s.setAppMeta);
  const setEditors = useAppStore((s) => s.setEditors);
  const setStacks = useAppStore((s) => s.setStacks);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [services, info] = await Promise.all([ipc.listServices(), ipc.appInfo()]);
        if (cancelled) return;

        setServices(services);
        setAppMeta(info.version, info.state_dir);

        const [detectedEditors, stacks] = await Promise.all([
          ipc.detectEditors(),
          ipc.listStacks(),
        ]);
        if (cancelled) return;

        setEditors(detectedEditors);
        setStacks(stacks);
        for (const stack of stacks.filter((item) => item.auto_start)) {
          ipc.startStack(stack.id).catch(() => {});
        }
      } catch (err) {
        console.error('initial load failed', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setAppMeta, setEditors, setServices, setStacks]);
}
