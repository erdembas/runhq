import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { runInNewContext } from './helpers/i18n-vm.mjs';

const jsx = (type, props, key) => ({ type, props, key });
const descendants = (node) =>
  !node || typeof node !== 'object'
    ? []
    : Array.isArray(node)
      ? node.flatMap(descendants)
      : [node, ...descendants(node.props?.children)];
const text = (node) =>
  node == null || typeof node === 'boolean'
    ? ''
    : Array.isArray(node)
      ? node.map(text).join('')
      : typeof node === 'object'
        ? text(node.props?.children)
        : String(node);

function load(relative, imports = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      CSS: { escape: (value) => value },
      require: (name) => {
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
        if (name === 'lucide-react') return new Proxy({}, { get: (_, icon) => icon });
        if (Object.hasOwn(imports, name)) return imports[name];
        throw new Error(`Unexpected import ${name}`);
      },
    },
  );
  return exports;
}

const plans = load('../../../packages/cockpit-ui/src/lib/agentPlans.ts');
const canvas = load('../../../packages/cockpit-ui/src/lib/agentCanvas.ts');
const activity = load('../src/components/agents/agentActivity.ts');
const item = (id, kind, value) => ({ id, kind, text: value, title: '', status: 'completed' });
const items = [
  item('question', 'user', 'Build a small app'),
  item('plan-old', 'plan', '- [ ] Start with the data model'),
  item('plan-new', 'plan', '- [ ] Add the screen'),
  item(
    'preview-old',
    'assistant',
    '```html title="First screen"\n<html><body>First</body></html>\n```',
  ),
  item(
    'preview-new',
    'assistant',
    '```svg title="Diagram"\n<svg></svg>\n```\n\n```markdown title="Notes"\n# Notes\n```',
  ),
];

// The real session component owns interaction state; leaf surfaces are represented by JSX nodes.
// Plan/artifact extraction and transcript grouping run their production implementations.
function harness(initialItems = items) {
  const slots = [];
  let cursor = 0;
  let tree;
  let dirty = false;
  let effects = [];
  let layoutEffects = [];
  let viewProps = { visible: true };
  let elements = new Map();
  let viewportHidden = false;
  const scrolls = [];
  const viewport = {
    scrollTop: 0,
    scrollHeight: 4000,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelector: (selector) => elements.get(selector.match(/data-agent-item="([^"]+)"/)?.[1]),
  };
  const snapshotState = { snapshot: { items: initialItems }, loadOlder: () => {} };
  const session = {
    id: 'task-a',
    project_id: 'project-a',
    project_name: 'Project A',
    cwd: '/isolated/project-a',
    branch: 'task/screen',
    title: 'Build a screen',
    isolated: true,
    backend: 'codex',
    status: 'completed',
    pending: [],
    model: '',
    effort: '',
    mode: 'default',
    agent: '',
  };
  const scheduleEffect = (queue, effect, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
      queue.push(effect);
      slots[index] = deps;
    }
  };
  const react = {
    memo: (component) => component,
    useId: () => 'session-view',
    useMemo: (factory) => factory(),
    useEffect: (effect, deps) => scheduleEffect(effects, effect, deps),
    useLayoutEffect: (effect, deps) => scheduleEffect(layoutEffects, effect, deps),
    useRef: (value) => (slots[cursor++] ??= { current: value }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value) => {
          const next = typeof value === 'function' ? value(slots[index]) : value;
          if (!Object.is(next, slots[index])) dirty = true;
          slots[index] = next;
        },
      ];
    },
  };
  const imports = {
    react,
    'react-markdown': { default: 'ReactMarkdown' },
    'remark-gfm': {},
    '@tauri-apps/plugin-clipboard-manager': {},
    '@runhq/cockpit-ui': new Proxy(
      { ...plans, ...canvas, agentIsActive: () => false, agentProviderNames: {} },
      { get: (target, name) => target[name] ?? name },
    ),
    '@/lib/useMessageSendShortcut': { useMessageSendShortcut: () => ({}) },
    '@/lib/useVisibleStore': { useVisibleStore: (store, selector) => selector(store.getState()) },
    '@/lib/usePersistentBoolean': { usePersistentBoolean: (_, value) => react.useState(value) },
    '@/lib/ipc': { ipc: {} },
    '@/store/useAgentStore': {
      useAgentStore: {
        getState: () => ({ tools: [{ id: 'codex', enabled: true }], drafts: {} }),
      },
    },
    '@/store/useAgentLibraryStore': {
      useAgentLibraryStore: { getState: () => ({ records: {} }) },
    },
    '@/store/useAgentQueueStore': {
      useAgentQueueStore: { getState: () => ({ queues: {} }) },
      agentTurnQueue: {},
    },
    './useAgentSnapshot': {
      useAgentSnapshot: () => snapshotState,
    },
    './useAgentCatalog': { useAgentCatalog: () => ({ catalog: null }) },
    './useAgentContext': { useAgentContext: () => ({ entries: [], ready: true }) },
    './agentAccountRouting': { parseRoutingNote: () => null },
    './agentSendRecovery': { recoverableAgentSender: { recovered: () => null } },
    './agentComposerPolicy': {
      agentSessionIsHistoryOnly: () => false,
      agentComposerContent: () => false,
    },
    './agentActivity': activity,
    './agentLibraryModel': {},
    './agentDecisionActions': {},
    './agentSubagentItem': {},
    '@/components/ai/markdownComponents': {},
  };
  for (const name of [
    'AgentPlanPanel',
    'AgentCanvasPanel',
    'AgentChangesPanel',
    'AgentTaskTerminalDock',
    'AgentActivityBlock',
    'AgentContextTray',
    'AgentUsageCard',
    'AgentTaskLinks',
    'AgentSessionProject',
    'AgentUserMessage',
    'AgentMessageNavigator',
    'AgentPauseControl',
  ])
    imports[`./${name}`] = { [name]: name };
  imports['./AgentUsageNotifications'] = { AgentUsageGuardNotice: 'AgentUsageGuardNotice' };
  imports['@/components/EditorDropdown'] = { EditorDropdown: 'EditorDropdown' };
  const { AgentSessionView } = load('../src/components/agents/AgentSessionView.tsx', imports);
  // Commit refs and the narrow-window visibility before effects. Pending effect updates only
  // change the next render, matching the browser's inability to scroll display:none content.
  const attachLayout = (node, hidden = !viewProps.visible) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child) => attachLayout(child, hidden));
      return;
    }
    hidden ||= !!node.props.hidden || /(?:^|\s)hidden(?:\s|$)/.test(node.props.className ?? '');
    if (node.props.ref && node.props.onScroll) {
      node.props.ref.current = viewport;
      viewportHidden = hidden;
    }
    const id = node.props['data-agent-item'];
    if (id) {
      const top = 80 + elements.size * 150;
      elements.set(id, {
        getBoundingClientRect: () => ({ top: top - viewport.scrollTop }),
        focus: () => {},
        scrollIntoView(options) {
          scrolls.push({ id, hidden: hidden || viewportHidden, options });
          if (!hidden && !viewportHidden) viewport.scrollTop = top;
        },
      });
    }
    attachLayout(node.props.children, hidden);
  };
  const render = (flush = true) => {
    let commits = 0;
    do {
      assert(commits++ < 20, 'Session effects must settle');
      cursor = 0;
      dirty = false;
      effects = [];
      layoutEffects = [];
      tree = AgentSessionView({ session, ...viewProps });
      elements = new Map();
      attachLayout(tree);
      layoutEffects.forEach((effect) => effect());
      effects.forEach((effect) => effect());
    } while (flush && dirty);
  };
  render();
  return {
    session,
    render,
    viewport,
    scrolls,
    updateProps(next, flush = true) {
      viewProps = { ...viewProps, ...next };
      render(flush);
    },
    all: () => descendants(tree),
    find: (type) => descendants(tree).find((node) => node.type === type),
    buttons(root = tree) {
      return descendants(root).filter((node) => node.type === 'button');
    },
    click(button, event) {
      assert(button, 'Expected button to exist');
      button.props.onClick(event);
      render();
    },
    message(id) {
      return descendants(tree).find((node) => node.props?.['data-agent-item'] === id);
    },
  };
}

test('primary navigation contains only Chat and Changes, including tasks with plans and previews', () => {
  for (const messages of [[], items]) {
    const h = harness(messages);
    assert.deepEqual(h.buttons(h.find('nav')).map(text), ['Chat', 'Changes']);
    assert.equal(h.find('AgentPlanPanel'), undefined);
    assert.equal(h.find('AgentCanvasPanel'), undefined);
    assert.equal(h.find('AgentTaskTerminalDock').props.terminalOpen, false);
    h.click(h.buttons(h.find('nav')).find((button) => text(button) === 'Changes'));
    assert.equal(h.find('AgentChangesPanel').props.visible, true);
  }
});

test('each contextual action selects the exact plan or preview from its source message', () => {
  const h = harness();
  assert.equal(h.buttons(h.message('question')).length, 0);
  assert.equal(h.buttons(h.message('preview-new')).length, 2);
  h.click(h.buttons(h.message('plan-old')).find((button) => text(button) === 'Review plan'));
  assert.equal(h.find('AgentPlanPanel').props.selectedId, 'plan-old');
  h.click(h.buttons().find((button) => button.props['aria-label'] === 'Close plan'));
  h.click(h.buttons(h.message('preview-old'))[0]);
  assert.equal(h.find('AgentCanvasPanel').props.selectedId, 'preview-old:0');
  h.click(h.buttons(h.message('preview-new')).find((button) => text(button).includes('Notes')));
  assert.equal(h.find('AgentCanvasPanel').props.selectedId, 'preview-new:1');
});

test('reviewed-plan prompts attach their plan action to the originating user message', () => {
  const h = harness([
    item('reviewed-message', 'user', plans.buildAgentPlanPrompt('Build the app')),
  ]);
  h.click(h.buttons(h.message('reviewed-message'))[0]);
  assert.equal(h.find('AgentPlanPanel').props.selectedId, 'reviewed-reviewed-message');
});

test('the pending-request action returns to chat and dismisses the contextual surface', () => {
  const h = harness();
  h.session.pending = [{ id: 'permission', title: 'Approve operation' }];
  h.render();
  h.click(h.buttons(h.message('plan-old'))[0]);
  h.click(h.buttons().find((button) => text(button).includes('need your response')));
  assert.equal(h.find('AgentPlanPanel'), undefined);
  assert.equal(h.buttons(h.find('nav'))[0].props['aria-pressed'], true);
  h.click(h.buttons(h.find('nav'))[1]);
  h.click(h.buttons().find((button) => text(button).includes('need your response')));
  assert.equal(h.find('AgentChangesPanel').props.visible, false);
  assert.equal(h.buttons(h.find('nav'))[0].props['aria-pressed'], true);
});

test('focused messages reveal chat before scrolling and are not consumed while hidden', () => {
  for (const surface of ['changes', 'plan']) {
    const h = harness();
    if (surface === 'changes') h.click(h.buttons(h.find('nav'))[1]);
    else h.click(h.buttons(h.message('plan-old'))[0]);

    h.updateProps({ focusItemId: 'question', focusItemRevision: 1 }, false);
    assert.equal(
      h.scrolls.length,
      0,
      'The hidden-layout commit must not consume the focus request',
    );
    h.render();
    assert.equal(h.find('AgentPlanPanel'), undefined);
    assert.equal(h.buttons(h.find('nav'))[0].props['aria-pressed'], true);
    assert.equal(h.scrolls.length, 1);
    assert.equal(h.scrolls[0].id, 'question');
    assert.equal(h.scrolls[0].hidden, false);
    assert.equal(h.scrolls[0].options.block, 'center');
    h.render();
    assert.equal(h.scrolls.length, 1, 'An applied focus request should not scroll repeatedly');
  }
});

test('the pending-request action reaches the latest request after earlier-message navigation', () => {
  for (const surface of ['changes', 'plan']) {
    const h = harness();
    h.session.pending = [{ id: 'permission', title: 'Approve operation' }];
    h.render();
    h.find('AgentMessageNavigator').props.onNavigate('question');
    h.render();
    assert(h.viewport.scrollTop < h.viewport.scrollHeight - h.viewport.clientHeight);

    if (surface === 'changes') h.click(h.buttons(h.find('nav'))[1]);
    else h.click(h.buttons(h.message('plan-old'))[0]);
    h.click(h.buttons().find((button) => text(button).includes('need your response')));
    assert.equal(h.find('AgentPlanPanel'), undefined);
    assert.equal(h.buttons(h.find('nav'))[0].props['aria-pressed'], true);
    assert.equal(h.viewport.scrollTop, h.viewport.scrollHeight);
  }
});

test('the workspace terminal action closes its menu and opens the dock for the task directory', () => {
  const h = harness();
  const { AgentSessionProject } = load('../src/components/agents/AgentSessionProject.tsx', {
    react: { useState: (value) => [value, () => {}] },
    '@tauri-apps/plugin-clipboard-manager': {},
  });
  const menu = { open: true };
  const workspace = AgentSessionProject(h.find('AgentSessionProject').props);
  h.click(
    h.buttons(workspace).find((button) => text(button) === 'Open workspace terminal'),
    { currentTarget: { closest: () => menu } },
  );
  assert.equal(menu.open, false);
  const dock = h.find('AgentTaskTerminalDock');
  assert.equal(dock.props.terminalOpen, true);
  assert.equal(dock.props.cwd, h.session.cwd);
  assert.equal(dock.props.sessionId, h.session.id);
  dock.props.onHideTerminal();
  h.render();
  assert.equal(h.find('AgentTaskTerminalDock').props.terminalOpen, false);
});
