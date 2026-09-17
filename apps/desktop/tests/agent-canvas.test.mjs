import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL('../../../packages/cockpit-ui/src/lib/agentCanvas.ts', import.meta.url),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports },
);
const {
  extractAgentCanvasArtifacts,
  agentCanvasStorageKey,
  readAgentCanvasEdit,
  buildAgentCanvasDocument,
  agentCanvasDownloadName,
  AGENT_CANVAS_CSP,
  AGENT_CANVAS_SANDBOX,
} = exports;
const item = (text, kind = 'assistant', id = 'response-1') => ({
  id,
  kind,
  text,
  title: 'Agent',
  status: 'completed',
  created_at: 1,
});

test('extracts complete HTML, SVG and Markdown artifacts while ignoring tools, user prompts and unsupported code', () => {
  const result = extractAgentCanvasArtifacts([
    item('```html\n<p>User example</p>\n```', 'user'),
    item('```html\n<p>Tool output</p>\n```', 'tool'),
    item(
      '```js\nconsole.log(1)\n```\n```HTML\n<title>Project dashboard</title><button>Try me</button>\n```\n~~~svg title="Architecture"\n<svg></svg>\n~~~\n```md\n# Launch plan\n- ship it\n```',
    ),
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0].id, 'response-1:1');
  assert.equal(result[0].title, 'Project dashboard');
  assert.equal(result[1].kind, 'svg');
  assert.equal(result[1].title, 'Architecture');
  assert.equal(result[2].title, 'Launch plan');
});

test('partial streaming fences never run and a later completed artifact retains its ID', () => {
  const prefix = '```html\n<div>Loading</div>\n';
  assert.equal(extractAgentCanvasArtifacts([item(prefix)]).length, 0);
  const finished = extractAgentCanvasArtifacts([item(`${prefix}\`\`\``)])[0];
  const extended = extractAgentCanvasArtifacts([
    item(`${prefix}\`\`\`\nMore text\n\`\`\`svg\n<svg/>\n\`\`\``),
  ])[0];
  assert.equal(finished.id, extended.id);
  assert.equal(finished.source, extended.source);
});

test('long fences preserve nested code and recognize unlabeled full documents without guessing JS or JSX', () => {
  const result = extractAgentCanvasArtifacts([
    item(
      '````markdown\n# Guide\n```html\n<p>example</p>\n```\n````\n```\n<!doctype html><html></html>\n```\n```tsx\n<div />\n```',
    ),
  ]);
  assert.equal(result.length, 2);
  assert.match(result[0].source, /```html/);
  assert.equal(result[1].kind, 'html');
  assert.equal(
    extractAgentCanvasArtifacts([item('```html\r\n<p>ok</p>\r\n```')])[0].source,
    '<p>ok</p>',
  );
  assert.equal(extractAgentCanvasArtifacts([item('~~~html\n<p>not closed</p>\n```')]).length, 0);
  assert.equal(extractAgentCanvasArtifacts([item('```constructor\nnot HTML\n```')]).length, 0);
});

test('local edits are scoped to a session and artifact and never overwrite a revised provider source', () => {
  assert.notEqual(agentCanvasStorageKey('a:b', 'c'), agentCanvasStorageKey('a', 'b:c'));
  assert.notEqual(agentCanvasStorageKey('s1', 'same'), agentCanvasStorageKey('s2', 'same'));
  const stored = JSON.stringify({ original: '<p>one</p>', source: '<p>edited</p>' });
  assert.equal(readAgentCanvasEdit(stored, '<p>one</p>'), '<p>edited</p>');
  assert.equal(readAgentCanvasEdit(stored, '<p>revised</p>'), null);
  assert.equal(readAgentCanvasEdit('broken JSON', '<p>one</p>'), null);
  assert.equal(readAgentCanvasEdit('{"original":"a","source":123}', 'a'), null);
  assert.equal(readAgentCanvasEdit('{"original":"a","source":""}', 'a'), '');
});

test('HTML runs in an opaque origin with policy before any untrusted source and no remote dependencies or host privileges', () => {
  assert.equal(AGENT_CANVAS_SANDBOX, 'allow-scripts');
  const attack =
    '<script>parent.document.body.remove();fetch("https://example.com")</script><meta http-equiv="Content-Security-Policy" content="default-src *">';
  const preview = buildAgentCanvasDocument('html', attack);
  assert(preview.indexOf('default-src') < preview.indexOf(attack));
  for (const directive of [
    "default-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ])
    assert(AGENT_CANVAS_CSP.includes(directive));
  assert(!AGENT_CANVAS_CSP.includes('unsafe-eval'));
  assert(!AGENT_CANVAS_CSP.includes('https:'));
  assert.match(preview, /name="referrer" content="no-referrer"/);
});

test('SVG preview is an encoded image, keeping scripts and foreign markup out of the HTML document', () => {
  const source = '<svg><script>alert(1)</script><foreignObject><div>"</div></foreignObject></svg>';
  const preview = buildAgentCanvasDocument('svg', source);
  assert(!preview.includes('<svg>'));
  assert(!preview.includes('<script>'));
  assert.match(preview, /<img alt="SVG canvas" src="data:image\/svg\+xml;charset=utf-8,/);
  const encoded = preview.match(/charset=utf-8,([^"<>]+)/)[1];
  assert.equal(decodeURIComponent(encoded), source);
});

test('downloads use artifact file types and safe names without directory traversal', () => {
  assert.equal(
    agentCanvasDownloadName({ title: '../../Project plan.md', kind: 'markdown' }),
    '..-..-Project-plan.md',
  );
  assert.equal(
    agentCanvasDownloadName({ title: 'Dashboard.html', kind: 'html' }),
    'Dashboard.html',
  );
  assert.equal(agentCanvasDownloadName({ title: '   ', kind: 'svg' }), 'canvas.svg');
});

const bootstrap = readFileSync(
  new URL('../src-tauri/src/agent_canvas_bootstrap.html', import.meta.url),
  'utf8',
);
const bootstrapScript = bootstrap.match(/<script>([\s\S]*?)<\/script>/)[1];

function runBootstrap(fragment) {
  const calls = [];
  const document = {
    body: { textContent: '' },
    open: () => calls.push('open'),
    write: (source) => calls.push(source),
    close: () => calls.push('close'),
  };
  runInNewContext(bootstrapScript, { document, window: { location: { hash: fragment } } });
  return { calls, error: document.body.textContent };
}

test('packaged preview bootstrap decodes only its fragment and installs the same restricted document', () => {
  const source = buildAgentCanvasDocument(
    'html',
    '<button onclick="this.textContent = \'Clicked\'">Try me</button>',
  );
  const result = runBootstrap(`#${encodeURIComponent(source)}`);
  assert.deepEqual(result.calls, ['open', source, 'close']);
  assert.equal(result.error, '');
});

test('packaged preview rejects oversized, missing or malformed fragments without writing a document', () => {
  for (const fragment of ['', '#%broken', `#${'x'.repeat(500001)}`, `#${'x'.repeat(1500001)}`]) {
    const result = runBootstrap(fragment);
    assert.equal(result.calls.length, 0);
    assert(result.error);
  }
});
