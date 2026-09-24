import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('shared editor initialization installs bundled workers before Monaco starts', async () => {
  const modules = new Map();
  const createdWorkers = [];
  let monacoLoads = 0;
  let loaderConfig;
  const context = {
    MonacoEnvironment: { globalAPI: true },
  };
  const monaco = { editor: {} };
  function load(path) {
    if (modules.has(path)) return modules.get(path);
    const exports = {};
    modules.set(path, exports);
    const source = readFileSync(new URL(`../src/lib/${path}.ts`, import.meta.url), 'utf8');
    runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        ...context,
        globalThis: context,
        exports,
        require(name) {
          if (name === 'react') return {};
          if (name === './monacoWorkers') return load('monacoWorkers');
          if (name === '@monaco-editor/react')
            return {
              loader: {
                config: (value) => {
                  loaderConfig = value;
                },
              },
            };
          if (name === 'monaco-editor') {
            // Diff editors can request this worker as soon as Monaco is imported.
            // A blob bootstrap cannot run under the desktop's self-only CSP.
            assert.equal(typeof context.MonacoEnvironment.getWorker, 'function');
            monacoLoads++;
            return monaco;
          }
          if (name.endsWith('.worker.js?worker')) {
            return {
              default: class BundledWorker {
                constructor() {
                  this.entry = name;
                  createdWorkers.push(this);
                }
              },
            };
          }
          throw new Error(`Unexpected import: ${name}`);
        },
      },
    );
    return exports;
  }
  const { ensureMonaco } = load('monacoRuntime');
  const first = ensureMonaco();
  assert.equal(ensureMonaco(), first);
  await first;
  assert.equal(monacoLoads, 1);
  assert.equal(loaderConfig.monaco.editor, monaco.editor);
  assert.equal(context.MonacoEnvironment.globalAPI, true);
  const worker = (label) => context.MonacoEnvironment.getWorker('workerMain.js', label);
  assert.match(worker('editorWorkerService').entry, /editor\/editor\.worker\.js\?worker$/);
  assert.match(worker('json').entry, /json\/json\.worker/);
  assert.match(worker('scss').entry, /css\/css\.worker/);
  assert.match(worker('html').entry, /html\/html\.worker/);
  assert.match(worker('javascript').entry, /typescript\/ts\.worker/);
  assert.notEqual(worker('editorWorkerService'), createdWorkers[0]);
});
