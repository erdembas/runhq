import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
      '**/node_modules/**',
      '**/vite.config.ts',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLSpanElement: 'readonly',
        HTMLAnchorElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLParagraphElement: 'readonly',
        HTMLHeadingElement: 'readonly',
        HTMLDetailsElement: 'readonly',
        HTMLPreElement: 'readonly',
        IntersectionObserver: 'readonly',
        Range: 'readonly',
        CSS: 'readonly',
        Highlight: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        Event: 'readonly',
        StorageEvent: 'readonly',
        CustomEvent: 'readonly',
        FocusEvent: 'readonly',
        PointerEvent: 'readonly',
        DragEvent: 'readonly',
        WheelEvent: 'readonly',
        React: 'readonly',
        getComputedStyle: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        TextEncoder: 'readonly',
        Uint8Array: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        Node: 'readonly',
        NodeFilter: 'readonly',
        Text: 'readonly',
        URL: 'readonly',
        performance: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      'no-restricted-globals': ['error', 'confirm', 'alert', 'prompt'],
    },
  },
  {
    // Next.js App Router file conventions.
    //
    // App Router pages, layouts and route handlers are *required* to
    // export specific non-component values alongside the default
    // component (`metadata`, `viewport`, `generateStaticParams`,
    // `dynamic`, `revalidate`, etc.). The `react-refresh` plugin's
    // `only-export-components` rule was designed for plain React +
    // Vite's HMR contract, where mixing exports breaks fast refresh —
    // App Router has its own module-graph contract and the rule
    // doesn't apply. We mute it for files that live under
    // `apps/site/src/app/**` so the canonical Next exports stop
    // tripping the lint gate without disabling the rule for the rest
    // of the workspace.
    files: ['apps/site/src/app/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
];
