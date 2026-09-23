import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const directory = new URL('../../../packages/cockpit-ui/src/i18n/', import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('core.ts', directory), 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
function runtime({ saved, language = 'en-US', denied = false } = {}) {
  const exports = {};
  const document = { documentElement: { lang: 'en' } };
  const storage = new Map(saved === undefined ? [] : [['rhq-locale', saved]]);
  const events = new Map();
  runInNewContext(code, {
    exports,
    document,
    window: {
      navigator: { language },
      localStorage: {
        getItem: (key) => {
          if (denied) throw Error('blocked');
          return storage.get(key) ?? null;
        },
        setItem: (key, value) => {
          if (denied) throw Error('blocked');
          storage.set(key, value);
        },
      },
      addEventListener: (name, listener) => events.set(name, listener),
      removeEventListener: (name) => events.delete(name),
    },
    require: (name) => JSON.parse(readFileSync(new URL(name, directory), 'utf8')),
  });
  return { ...exports, storage, document, events };
}

test('desktop prefers a valid saved locale, detects Turkish variants and falls back to English', () => {
  for (const [options, expected] of [
    [{ language: 'tr-TR' }, 'tr'],
    [{ language: 'TR_tr' }, 'tr'],
    [{ language: 'de-DE' }, 'en'],
    [{ language: 'tr', saved: 'en' }, 'en'],
    [{ language: 'tr', saved: 'invalid' }, 'tr'],
    [{ language: 'tr', denied: true }, 'tr'],
  ]) {
    const app = runtime(options);
    app.initializeLocale();
    assert.equal(app.getLocale(), expected);
    assert.equal(app.document.documentElement.lang, expected);
  }
});

test('language switching persists once per value and updates all subscribers without remounting', () => {
  const app = runtime();
  let changes = 0;
  const stop = app.subscribe(() => changes++);
  app.setLocale('tr');
  assert.equal(app.t('Settings'), 'Ayarlar');
  assert.equal(app.storage.get('rhq-locale'), 'tr');
  app.setLocale('tr');
  app.setLocale('invalid');
  assert.equal(changes, 1);
  app.setLocale('en');
  assert.equal(app.t('Settings'), 'Settings');
  assert.equal(changes, 2);
  stop();
  app.setLocale('tr');
  assert.equal(changes, 2);
});

test('cross-window storage updates apply immediately, including cleared preferences', () => {
  const app = runtime({ language: 'tr-TR', saved: 'en' });
  const stop = app.initializeLocale();
  app.storage.set('rhq-locale', 'tr');
  app.events.get('storage')({ key: 'rhq-locale' });
  assert.equal(app.getLocale(), 'tr');
  app.storage.set('rhq-locale', 'en');
  app.events.get('storage')({ key: 'unrelated-key' });
  assert.equal(app.getLocale(), 'tr');
  app.events.get('storage')({ key: 'rhq-locale' });
  assert.equal(app.getLocale(), 'en');
  app.storage.clear();
  app.events.get('storage')({ key: null });
  assert.equal(app.getLocale(), 'tr');
  stop();
  assert.equal(app.events.size, 0);
});

test('interpolation preserves user and agent content, including markup and placeholder-like text', () => {
  const app = runtime();
  app.setLocale('tr');
  const supplied = '<b>Settings {title}</b> · Agent answer';
  assert.equal(app.t('Open {value1}', { value1: supplied }), `${supplied} aç`);
  assert.equal(app.t('Unavailable future key'), 'Unavailable future key');
});

test('count-dependent messages and number/date formatting follow the selected locale', () => {
  const app = runtime();
  const one = '{count} task needs your decision';
  const other = '{count} tasks need your decision';
  assert.equal(app.plural(one, other, 1), '1 task needs your decision');
  assert.equal(app.plural(one, other, 2), '2 tasks need your decision');
  assert.equal(app.number(1234.5), '1,234.5');
  app.setLocale('tr');
  for (const count of [0, 1, 2])
    assert.equal(app.plural(one, other, count), `${count} görev kararınızı bekliyor`);
  assert.equal(app.number(1234.5), '1.234,5');
  assert.match(app.date(Date.UTC(2026, 8, 23), { month: 'long', timeZone: 'UTC' }), /Eylül/);
  assert.equal(app.relative(-1, 'day'), 'dün');
});

test('module-level status labels remain live after switching languages', () => {
  const app = runtime();
  const labels = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL('../components/agentStatus.ts', directory), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports: labels, require: () => app },
  );
  assert.equal(labels.AGENT_STATUS_LABELS.running, 'Working');
  app.setLocale('tr');
  assert.equal(labels.AGENT_STATUS_LABELS.running, 'Çalışıyor');
  app.setLocale('en');
  assert.equal(labels.AGENT_STATUS_LABELS.running, 'Working');
});

test('startup category and runtime tables import without React and keep translations live', () => {
  const app = runtime();
  const loadTable = (name) => {
    const exports = {};
    runInNewContext(
      ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        exports,
        require: (specifier) => {
          assert.match(specifier, /^@runhq\/cockpit-ui\/i18n(?:\/core)?$/);
          return app;
        },
      },
    );
    return exports;
  };
  const categories = loadTable('categories');
  const runtimes = loadTable('runtimes');
  const category = categories.categoryForTags(['database']);
  const unknownRuntime = runtimes.runtimeMeta('custom');
  assert.equal(category.label, 'Database');
  assert.equal(unknownRuntime.label, 'Other');
  assert.equal(runtimes.runtimeMeta('node'), runtimes.RUNTIMES[0]);
  assert.equal(categories.categoryForTags(['custom']).key, 'other');
  app.setLocale('tr');
  assert.equal(category.label, 'Veritabanı');
  assert.equal(unknownRuntime.label, 'Diğer');
  app.setLocale('en');
  assert.equal(category.label, 'Database');
  assert.equal(unknownRuntime.label, 'Other');
});

test('activity summaries translate complete count phrases while preserving supplied paths and text', () => {
  const app = runtime();
  const activity = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/components/agents/agentActivity.ts', import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    { exports: activity, require: () => app },
  );
  const items = ['src/Settings.tsx', 'src/English.tsx'].map((path, index) => ({
    id: String(index),
    kind: 'tool',
    title: 'Read',
    text: JSON.stringify({ file_path: path }),
    status: 'completed',
    created_at: 0,
  }));
  assert.equal(activity.summarizeAgentActivity(items), 'Read 2 files');
  app.setLocale('tr');
  assert.equal(activity.summarizeAgentActivity(items), '2 dosya okundu');
  assert.equal(activity.describeAgentActivity(items[0]).target, 'src/Settings.tsx');
  assert.equal(
    activity.describeAgentActivity({
      ...items[0],
      title: 'Provider tool',
      text: 'Provider response',
    }).target,
    'Provider tool',
  );
});

test('rich text reorders placeholders without changing their React identity or supplied content', () => {
  const core = runtime();
  const rich = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL('index.tsx', directory), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports: rich,
      require: (name) =>
        name === './core'
          ? core
          : {
              Fragment: 'fragment',
              createElement: (type, props, children) => ({ type, key: props.key, children }),
            },
    },
  );
  const input = { type: 'input', value: 'User draft {literal}' };
  const english = rich.rich('Open {value1}', { value1: input });
  core.setLocale('tr');
  const turkish = rich.rich('Open {value1}', { value1: input });
  assert.equal(
    english.find((part) => part.children === input).key,
    turkish.find((part) => part.children === input).key,
  );
  assert.equal(english[0].children, 'Open ');
  assert.equal(turkish.at(-1).children, ' aç');
  assert.equal(input.value, 'User draft {literal}');
});
