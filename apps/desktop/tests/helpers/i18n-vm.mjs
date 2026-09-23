import { URL } from 'node:url';
// Shared dependency for the repository's standalone TypeScript VM tests.
// Execute the actual catalog/runtime; only the React host hooks use each test's existing shim.
import { readFileSync } from 'node:fs';
import { runInNewContext as runVm } from 'node:vm';
import ts from 'typescript';

const directory = new URL('../../../../packages/cockpit-ui/src/i18n/', import.meta.url);
export const i18n = {};
runVm(
  ts.transpileModule(readFileSync(new URL('core.ts', directory), 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    exports: i18n,
    require: (name) => JSON.parse(readFileSync(new URL(name, directory), 'utf8')),
  },
);
runVm(
  ts.transpileModule(readFileSync(new URL('labels.ts', directory), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports: i18n, require: () => i18n },
);

export function runInNewContext(code, context = {}, options) {
  const original = context.require;
  return runVm(
    code,
    {
      ...context,
      require: (name) => {
        if (/(?:^|\/)i18n(?:\/core)?$/.test(name)) {
          return {
            ...i18n,
            useLocale: () => i18n.getLocale(),
            useLocaleMemo: (factory, dependencies) => {
              const react = original?.('react');
              return react?.useMemo ? react.useMemo(factory, dependencies) : factory();
            },
            rich: (key, values) =>
              i18n
                .message(key)
                .split(/(\{\w+\})/g)
                .map((part) =>
                  /^\{\w+\}$/.test(part) && Object.hasOwn(values, part.slice(1, -1))
                    ? values[part.slice(1, -1)]
                    : part,
                ),
          };
        }
        if (!original) throw new Error(`Unexpected import ${name}`);
        return original(name);
      },
    },
    options,
  );
}
