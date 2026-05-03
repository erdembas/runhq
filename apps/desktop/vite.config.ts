import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  clearScreen: false,
  build: {
    // Workaround for xterm.js v6.0.0 bug #5800: esbuild's identifier
    // mangler corrupts a closure capture in `InputHandler.requestMode`
    // when re-minifying xterm's already-minified ESM, breaking every
    // DECRQM-using TUI (opencode, claude-code, gemini, …) in
    // production builds. Terser does proper AST scope tracking and
    // handles the file correctly. See `docs/KNOWN_ISSUES.md` for
    // root cause, removal criteria, and tracking links.
    minify: 'terser' as const,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'quick-action': path.resolve(__dirname, 'quick-action.html'),
        'tray-hint': path.resolve(__dirname, 'tray-hint.html'),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}));
