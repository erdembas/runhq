import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Use the real catalog and interpolation in isolated component/logic tests.
const root = new URL('../../../../packages/cockpit-ui/src/i18n/', import.meta.url);
function load(file, imports) {
  const exports = {};
  new Function(
    'exports',
    'require',
    ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(exports, (name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error(`Unexpected i18n import: ${name}`);
  });
  return exports;
}
export const i18nCore = load('core.ts', {
  './en.json': { default: JSON.parse(readFileSync(new URL('en.json', root), 'utf8')) },
  './tr.json': { default: JSON.parse(readFileSync(new URL('tr.json', root), 'utf8')) },
});
export const i18nView = load('index.tsx', {
  './core': i18nCore,
  './labels': load('labels.ts', { './core': i18nCore }),
  react: {
    useMemo: (create) => create(),
    Fragment: 'Fragment',
    createElement: (type, props, children) => ({ type, props: { ...props, children } }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  },
});
