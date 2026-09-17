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
      new URL('../src/components/agents/agentCanvasPreviewPolicy.ts', import.meta.url),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports, URL },
);
const { agentCanvasFramePolicy, installAgentCanvasFramePolicy } = exports;
const endpoint = 'http://127.0.0.1:54321/11111111-2222-4333-8444-555555555555/canvas';

function hostDocument() {
  const elements = [];
  return {
    elements,
    head: {
      querySelector: () => elements[0] ?? null,
      appendChild: (element) => elements.push(element),
    },
    createElement: (name) => {
      assert.equal(name, 'meta');
      return {
        setAttribute: (key, value) => {
          assert.equal(key, 'data-runhq-canvas-policy');
          assert.equal(value, '');
        },
      };
    },
  };
}

test('parent frame policy permits only the exact private renderer, removing self and wildcard loopback', () => {
  assert.equal(agentCanvasFramePolicy(endpoint), `frame-src ${endpoint}`);
  assert(!agentCanvasFramePolicy(endpoint).includes("'self'"));
  assert(!agentCanvasFramePolicy(endpoint).includes('*'));
});

test('untrusted hosts, schemes, paths, credentials and CSP injection cannot become a frame source', () => {
  for (const bad of [
    'tauri://localhost/',
    'http://localhost:54321/canvas',
    'http://127.0.0.1:54321/',
    endpoint.replace('127.0.0.1', 'attacker.example'),
    endpoint.replace('http:', 'https:'),
    endpoint.replace('127.0.0.1', 'user@127.0.0.1'),
    `${endpoint}?source=secret`,
    `${endpoint}#source`,
    `${endpoint}; frame-src *`,
    endpoint.replace(':54321', ''),
    endpoint.replace(':54321', ':80'),
  ])
    assert.throws(() => agentCanvasFramePolicy(bad));
});

test('policy is installed synchronously, retained across artifact changes and cannot silently widen', () => {
  const document = hostDocument();
  installAgentCanvasFramePolicy(document, endpoint);
  assert.equal(document.elements.length, 1);
  assert.equal(document.elements[0].httpEquiv, 'Content-Security-Policy');
  assert.equal(document.elements[0].content, `frame-src ${endpoint}`);
  installAgentCanvasFramePolicy(document, endpoint);
  assert.equal(document.elements.length, 1);
  assert.throws(() => installAgentCanvasFramePolicy(document, endpoint.replace('54321', '54322')));
  assert.equal(document.elements[0].content, `frame-src ${endpoint}`);
});

test('an invalid endpoint never installs a policy or permits a preview', () => {
  const document = hostDocument();
  assert.throws(() => installAgentCanvasFramePolicy(document, 'http://127.0.0.1:54321/'));
  assert.equal(document.elements.length, 0);
});
