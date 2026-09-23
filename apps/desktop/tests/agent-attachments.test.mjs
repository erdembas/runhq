import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from './helpers/i18n-vm.mjs';
import ts from 'typescript';
import { validateAttachments } from '../../../packages/agent-runtime/src/attachments.mjs';

const source = readFileSync(
  new URL('../../../packages/cockpit-ui/src/lib/agentAttachments.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports });
const {
  validateAgentAttachments,
  agentSupportsImages,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_BASE64_LENGTH,
} = exports;
const image = { name: 'shot.png', mime_type: 'image/png', data: 'aGVsbG8=' };

test('composer and runtime agree on bounded supported image payloads', () => {
  const cases = [
    [],
    [image],
    Array(6).fill(image),
    [{ ...image, data: 'AB==' }],
    [{ ...image, data: 'AAB=' }],
    [{ ...image, data: '' }],
    [{ ...image, data: 'wrong' }],
    [{ ...image, mime_type: 'image/svg+xml' }],
    [{ ...image, name: 'bad\nname' }],
    [{ ...image, data: 'A'.repeat(MAX_AGENT_IMAGE_BASE64_LENGTH) }, image],
  ];
  for (const attachments of cases) {
    const uiAccepted = validateAgentAttachments(attachments) === null;
    let runtimeAccepted = true;
    try {
      validateAttachments(attachments, 'codex');
    } catch {
      runtimeAccepted = false;
    }
    assert.equal(uiAccepted, runtimeAccepted);
  }
  assert.equal(MAX_AGENT_IMAGE_BYTES, 2359296);
});

test('supported adapters are explicit and custom backend ids use the selected adapter', () => {
  assert.equal(agentSupportsImages('codex'), true);
  assert.equal(agentSupportsImages('claude'), true);
  assert.equal(agentSupportsImages('acp'), false);
  assert.equal(agentSupportsImages('opencode'), false);
  assert.equal(agentSupportsImages('my-custom-command'), false);
});
