import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { listen } from '@tauri-apps/api/event';
import { ipc } from '@/lib/ipc';

interface Props {
  id: string;
  cwd: string;
}

const NERD_FONT_STACK =
  '"MesloLGS NF", "MesloLGS Nerd Font", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "Menlo", "Monaco", "Consolas", "Courier New", monospace';

export function TerminalPane({ id, cwd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: NERD_FONT_STACK,
      letterSpacing: 0,
      lineHeight: 1.25,
      scrollback: 10_000,
      allowProposedApi: true,
      allowTransparency: false,
    });

    const unicodeAddon = new Unicode11Addon();
    term.loadAddon(unicodeAddon);
    term.unicode.activeVersion = '11';

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    requestAnimationFrame(() => {
      fit.fit();
      const { cols, rows } = term;
      void ipc.terminalCreate(id, cwd, cols, rows);
      term.focus();
    });

    term.onData((data) => {
      const encoded = new TextEncoder().encode(data);
      void ipc.terminalWrite(id, Array.from(encoded));
    });

    let alive = true;
    const unsubPromise = listen<{ id: string; data: number[] }>('terminal://output', (event) => {
      if (event.payload.id === id && alive) {
        const bytes = new Uint8Array(event.payload.data);
        term.write(bytes);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!alive) return;
      try {
        fit.fit();
        const { cols: c, rows: r } = term;
        void ipc.terminalResize(id, c, r);
      } catch {
        // ignore fit errors during teardown
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      alive = false;
      resizeObserver.disconnect();
      void ipc.terminalDestroy(id);
      void unsubPromise.then((fn) => fn());
      term.dispose();
    };
  }, [id, cwd]);

  return <div ref={containerRef} className="h-full w-full" style={{ minHeight: '200px' }} />;
}
