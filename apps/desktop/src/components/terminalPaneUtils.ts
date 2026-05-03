import { useEffect, useState } from 'react';
import type { Terminal } from '@xterm/xterm';

export const NERD_FONT_STACK =
  '"MesloLGS NF", "MesloLGS Nerd Font", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "Menlo", "Monaco", "Consolas", "Courier New", monospace';

export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark')),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

/**
 * Decode the base64 payload that the Rust PTY pipeline ships through
 * `Channel<TerminalOutput>`. `atob` returns a binary string (one
 * char per byte, low-byte preserved), and we copy it into a
 * `Uint8Array` via `charCodeAt`. The byte-length is identical to the
 * original PTY chunk, which is exactly what `Terminal.write` expects.
 *
 * We deliberately keep this synchronous — `atob` on a 32 KB payload
 * costs well under 1 ms on every browser shipped this decade, so the
 * detour through `Blob` + `arrayBuffer()` (which would let us decode
 * off the main thread but introduces async + GC pressure) isn't
 * worth it for our payload sizes.
 */
export function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Write a red error banner into the xterm itself.
 *
 *  Why in-band instead of a global toast: the user is staring at the
 *  terminal pane when this fires (they just opened it). A toast off in
 *  the corner is easy to miss and disconnected from the cause. A red
 *  in-pane line is impossible to ignore and shows up in scrollback if
 *  they later wonder why nothing's responding. The trailing reset
 *  (`\x1b[0m`) prevents the SGR red from bleeding into whatever the
 *  shell's first prompt prints. */
export function writeError(term: Terminal, message: string): void {
  term.write(`\r\n\x1b[31m✖ ${message}\x1b[0m\r\n`);
}

export interface MatchInfo {
  /** 1-indexed position of the active match for human display. */
  index: number;
  /** Total matches currently visible in the buffer. */
  count: number;
}
