import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { i18n, runInNewContext } from './helpers/i18n-vm.mjs';

const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const treeExports = {};
runInNewContext(compile('../src/lib/git-diff/tree.ts'), { exports: treeExports });
const compiled = compile('../src/components/agents/AgentChangesFileNav.tsx');

const changed = (path, overrides = {}) => ({
  path,
  additions: 1200,
  deletions: 2,
  status: 'modified',
  patch: '',
  section: 'agent',
  ...overrides,
});
const files = [
  changed('README.md'),
  changed('src/application/commands/first.ts'),
  changed('src/application/commands/second.ts'),
  changed('src/application/queries/find.ts'),
  changed('tests/unit/nested/test.ts'),
];

function mount(initial = {}) {
  let props = { files, selectedPath: files[1].path, view: 'list', onSelect: () => {}, ...initial };
  const slots = [];
  let cursor;
  let pending;
  let dirty;
  let nodes;
  const react = {
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value;
      return [
        slots[index],
        (update) => {
          const next = typeof update === 'function' ? update(slots[index]) : update;
          dirty ||= !Object.is(next, slots[index]);
          slots[index] = next;
        },
      ];
    },
    useId: () => 'changes-files',
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        pending.push(effect);
        slots[index] = deps;
      }
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') {
        const element = (type, props) => ({ type, props });
        return { jsx: element, jsxs: element };
      }
      if (name === 'lucide-react') return {};
      if (name === '@/lib/cn') return { cn: (...classes) => classes.filter(Boolean).join(' ') };
      if (name === '@/lib/fileIcon') return { FileTypeIcon: 'file-icon' };
      if (name === '@/lib/gitDiff') {
        return {
          ...treeExports,
          statusColor: { modified: 'modified', deleted: 'deleted' },
          statusLabel: { modified: 'Modified', deleted: 'Deleted' },
          statusLetter: { modified: 'M', deleted: 'D' },
        };
      }
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    walk(node.props.children);
  };
  const render = () => {
    let attempts = 0;
    do {
      assert(attempts++ < 10, 'Selection disclosure effects should settle');
      cursor = 0;
      dirty = false;
      pending = [];
      nodes = [];
      walk(exports.AgentChangesFileNav(props));
      pending.forEach((effect) => effect());
    } while (dirty);
  };
  render();
  return {
    get nodes() {
      return nodes;
    },
    selected: () => nodes.find((node) => node.props['aria-current'] === 'true'),
    folder: (path) => nodes.find((node) => node.type === 'button' && node.props.title === path),
    file: (path) =>
      nodes.find((node) => node.type === 'button' && node.props.title?.startsWith(`${path} · `)),
    update(next) {
      props = { ...props, ...next };
      render();
    },
    click(node) {
      assert(node, 'The clicked navigation entry must exist');
      node.props.onClick();
      render();
    },
  };
}

function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? text(node.props.children) : String(node);
}

test('flat files show the readable basename, directory, status and localized counts', () => {
  let selection;
  const nav = mount({ onSelect: (path) => (selection = path) });
  const selected = nav.selected();
  assert.equal(selected.props.title, 'src/application/commands/first.ts · Modified');
  assert.match(text(selected), /^first\.tssrc\/application\/commandsM\+1,200 −2$/);
  assert.equal(text(nav.file('README.md')), 'README.mdM+1,200 −2');
  nav.click(nav.file('src/application/queries/find.ts'));
  assert.equal(selection, 'src/application/queries/find.ts');
});

test('tree compacts folder chains and reveals selected file with accessible disclosures', () => {
  const nav = mount({ view: 'tree' });
  const root = nav.folder('src/application');
  assert.equal(root.props['aria-expanded'], true);
  assert.equal(nav.folder('src/application/commands').props['aria-expanded'], true);
  assert.equal(nav.folder('src/application/queries').props['aria-expanded'], false);
  assert.equal(text(nav.selected()), 'first.tsM+1,200 −2');
  assert.equal(text(root), 'src/application3');
  const group = nav.nodes.find((node) => node.props.id === root.props['aria-controls']);
  assert.equal(group.type, 'ul');
  assert.equal(group.props.hidden, false);
});

test('manual collapse survives background file refresh and locale changes', () => {
  const nav = mount({ view: 'tree' });
  nav.click(nav.folder('src/application/commands'));
  assert.equal(nav.selected(), undefined);
  nav.update({ files: files.map((file) => ({ ...file, additions: 1400 })) });
  assert.equal(nav.folder('src/application/commands').props['aria-expanded'], false);
  try {
    i18n.setLocale('tr');
    nav.update({});
    assert.equal(nav.folder('src/application/commands').props['aria-expanded'], false);
    nav.click(nav.folder('src/application/commands'));
    assert.match(text(nav.selected()), /\+1\.400 −2$/);
  } finally {
    i18n.setLocale('en');
  }
});

test('returning from list or selecting a hidden file opens its ancestor chain', () => {
  const nav = mount({ view: 'tree' });
  nav.click(nav.folder('src/application'));
  nav.update({ view: 'list' });
  nav.update({ view: 'tree' });
  assert(nav.selected(), 'Returning to tree must reveal the active file');
  nav.update({ selectedPath: 'tests/unit/nested/test.ts' });
  assert.equal(nav.folder('tests/unit/nested').props['aria-expanded'], true);
  assert.equal(nav.selected().props.title, 'tests/unit/nested/test.ts · Modified');
  assert.equal(nav.folder('src/application').props['aria-expanded'], true);
});
