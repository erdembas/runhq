import { useEffect } from 'react';
import { loader } from '@monaco-editor/react';

/**
 * Registers `runhq-dark` / `runhq-light` Monaco themes that derive their
 * colours from the same CSS variables the rest of the app uses. Re-runs on
 * every theme change so toggling the OS palette at runtime updates any
 * currently-mounted editor.
 *
 * Extracted to a shared hook so every component that mounts a Monaco
 * instance (DiffViewer, CrossProjectDiffViewer, future inline diff
 * surfaces) registers identical themes without duplicating 50 lines of
 * colour plumbing. Monaco theme defs are global, so concurrent callers
 * are idempotent — whoever wrote last wins, and they all write the same
 * thing.
 */
export function useMonacoTheme(effectiveTheme: 'dark' | 'light'): string {
  useEffect(() => {
    let cancelled = false;
    void loader.init().then((monaco) => {
      if (cancelled) return;
      const rgbVar = (name: string): string => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const parts = raw.split(/\s+/).map((v) => Number(v));
        if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return '#000000';
        const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
        return `#${toHex(parts[0]!)}${toHex(parts[1]!)}${toHex(parts[2]!)}`;
      };
      const bg = rgbVar('--surface');
      const muted = rgbVar('--surface-muted');
      const fg = rgbVar('--fg');
      const fgDim = rgbVar('--fg-dim');
      const border = rgbVar('--border');
      const isDark = effectiveTheme === 'dark';
      monaco.editor.defineTheme(isDark ? 'runhq-dark' : 'runhq-light', {
        base: isDark ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': bg,
          'editor.foreground': fg,
          'editorGutter.background': bg,
          'editorLineNumber.foreground': fgDim,
          'editorLineNumber.activeForeground': fg,
          'editor.lineHighlightBackground': muted,
          'editor.lineHighlightBorder': '#00000000',
          'editorIndentGuide.background': border,
          'editorIndentGuide.activeBackground': border,
          'editorWidget.background': bg,
          'editorWidget.border': border,
          'scrollbarSlider.background': isDark ? '#ffffff14' : '#0000000d',
          'scrollbarSlider.hoverBackground': isDark ? '#ffffff26' : '#00000017',
          'scrollbarSlider.activeBackground': isDark ? '#ffffff33' : '#00000022',
          // Line-level tint — covers the ENTIRE line width (VSCode parity).
          // Previous ~8% alpha was so subtle the block of added/removed
          // lines didn't read as a block; bumped to ~20% dark / ~15%
          // light to match VSCode's default diff decoration intensity.
          'diffEditor.insertedLineBackground': isDark ? '#10b98133' : '#10b98126',
          'diffEditor.removedLineBackground': isDark ? '#ef444433' : '#ef444426',
          // Character-level tint layered on top — brighter so the actual
          // changed tokens still stand out from the whole-line wash.
          'diffEditor.insertedTextBackground': isDark ? '#10b98155' : '#10b98140',
          'diffEditor.removedTextBackground': isDark ? '#ef444455' : '#ef444440',
          // Gutter badge + left-rail indicator tints so the +/- gutter
          // marks read clearly against the surface. Monaco falls back to
          // the text colour otherwise, which can be hard to see.
          'diffEditorGutter.insertedLineBackground': isDark ? '#10b98133' : '#10b98126',
          'diffEditorGutter.removedLineBackground': isDark ? '#ef444433' : '#ef444426',
          'diffEditor.border': border,
        },
      });
      monaco.editor.setTheme(isDark ? 'runhq-dark' : 'runhq-light');
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveTheme]);

  return effectiveTheme === 'dark' ? 'runhq-dark' : 'runhq-light';
}
