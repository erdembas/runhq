import { useEffect, useState } from 'react';
import { loader } from '@monaco-editor/react';

type MonacoModule = typeof import('monaco-editor');

let monacoPromise: Promise<MonacoModule> | null = null;

export function ensureMonaco(): Promise<MonacoModule> {
  if (!monacoPromise) {
    monacoPromise = import('monaco-editor').then((monaco) => {
      loader.config({ monaco });
      return monaco;
    });
  }
  return monacoPromise;
}

export function useMonacoReady(): { ready: boolean; error: string | null } {
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({
    ready: false,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    ensureMonaco()
      .then(() => {
        if (alive) setState({ ready: true, error: null });
      })
      .catch((error: unknown) => {
        if (alive) setState({ ready: false, error: String(error) });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
