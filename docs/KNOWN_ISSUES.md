# Known Issues

Tracking notes for upstream bugs we work around in this repo. When the
upstream fix lands, the workaround can usually be deleted.

## xterm.js v6.0.0 — `requestMode` ReferenceError under Vite production minify

- **Upstream**: [xtermjs/xterm.js#5800](https://github.com/xtermjs/xterm.js/issues/5800) (open as of writing)
- **Affects**: `@xterm/xterm@6.0.0` (current) when bundled by Vite 5/6 with the default esbuild minifier
- **Workaround location**: `apps/desktop/vite.config.ts` → `build.minify: 'terser'`

### Symptom

In production builds only (dev mode is fine), the embedded terminal
opens, paints a few bytes, then goes blank as soon as a TUI sends a
DEC private mode query (DECRQM, e.g. `CSI ?2026 $p` for synchronized
output capability detection). The browser console shows:

```
ReferenceError: <mangled> is not defined
    at requestMode (main-XYZ.js:...)
```

After the throw, xterm's DCS handler chain dies and every subsequent
`write()` is silently dropped. `top` and `vim` work; `opencode`,
`claude-code`, `gemini`, anything using `cli-spinners` v3+ or
spinning up an alternate-screen TUI does not.

### Root cause

xterm ships its ESM as already-minified output (`lib/xterm.mjs`).
esbuild's identifier-mangling pass mishandles a closure capture
inside `InputHandler.requestMode` when re-minifying the
already-minified file — the inner arrow function ends up referencing
a parameter name that no longer exists in the outer scope. Classic
double-minification scope bug.

The narrower workaround that the issue suggests
(`esbuild: { minifyIdentifiers: false }`) does NOT actually reach
Vite's `build.minify` pass — that pass uses esbuild's own internal
options table, not the top-level `esbuild` config block (see
[vitejs/vite#15565](https://github.com/vitejs/vite/issues/15565) and
@eottabom's confirmation comment on the xterm issue).

### Workaround

Switch the production minifier to terser, which does proper AST
scope tracking and handles the closure correctly:

```ts
// apps/desktop/vite.config.ts
build: {
  minify: 'terser' as const,
}
```

Bundle size impact: ~+160 KB gzipped on the main chunk vs. the
broken esbuild output. Webview load is unaffected (Tauri serves
assets from local disk). Build time ~+2 s.

### When to remove

Remove `minify: 'terser'` (and the `terser` dev dependency in
`apps/desktop/package.json`) when **either** of:

1. xterm ships unminified ESM in `lib/xterm.mjs` (likely target:
   v6.1+ — track issue #5800 and the v6.1 milestone)
2. esbuild fixes the scope-tracking bug for re-minified input
   (track [evanw/esbuild#3125](https://github.com/evanw/esbuild/issues/3125))

After removal, do a sanity test in the production build: open a
service terminal and run `opencode` (or any DECRQM-using TUI). If
the terminal stays blank, the bug is back; restore the workaround.
