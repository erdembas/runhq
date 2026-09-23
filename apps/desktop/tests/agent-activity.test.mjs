import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL('../src/components/agents/agentActivity.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports, require: () => ({}), JSON, Map },
);
const {
  agentActivityChange,
  agentActivityDiff,
  agentActivityPatch,
  agentActivityRelativePath,
  describeAgentActivity,
  groupAgentTranscript,
  sumAgentActivityChange,
  summarizeAgentActivity,
} = exports;

/** Values built inside the VM carry that realm's prototypes; compare their plain shape. */
const plain = (value) => JSON.parse(JSON.stringify(value));
const describe = (props) =>
  plain(
    describeAgentActivity({
      id: 'i',
      kind: 'tool',
      title: '',
      text: '',
      status: 'completed',
      created_at: 0,
      ...props,
    }),
  );
const item = (props) => ({
  id: 'i',
  kind: 'tool',
  title: '',
  text: '',
  status: 'completed',
  created_at: 0,
  ...props,
});

test('a tool named by the provider takes its target from the reported input', () => {
  assert.deepEqual(
    describe({ title: 'Read', text: '{\n  "file_path": "/repo/VaultClient.cs"\n}' }),
    {
      verb: 'Read',
      target: '/repo/VaultClient.cs',
      icon: 'read',
    },
  );
});

test('output appended after the input still yields the target', () => {
  assert.deepEqual(
    describe({ title: 'Bash', text: '{"command":"ls *.sln"}\n\n{"stdout":"RunHQ.sln"}' }),
    { verb: 'Run', target: 'ls *.sln', icon: 'run' },
  );
});

test('a tool titled by its target keeps the target and gains a verb from the input', () => {
  assert.deepEqual(
    describe({
      title: 'src/Infrastructure/Vault/VaultClient.cs',
      text: '{"input":{"filePath":"src/Infrastructure/Vault/VaultClient.cs","oldString":"a","newString":"b"},"output":"ok"}',
    }),
    { verb: 'Edit', target: 'src/Infrastructure/Vault/VaultClient.cs', icon: 'edit' },
  );
});

test('new content is a write, replaced text is an edit', () => {
  assert.equal(
    describe({ title: 'Write', text: '{"file_path":"a.cs","content":"x"}' }).icon,
    'write',
  );
  assert.equal(
    describe({ title: 'b.cs', text: '{"input":{"filePath":"b.cs","content":"x\\ny"}}' }).icon,
    'write',
  );
});

test('a multiline command is shown as its first line', () => {
  assert.equal(
    describe({ title: 'Bash', text: '{"command":"cd repo\\nmake test"}' }).target,
    'cd repo …',
  );
});

test('an unparseable body degrades to the raw title rather than hiding the row', () => {
  assert.deepEqual(describe({ title: 'weird-tool', text: 'truncated…{' }), {
    verb: null,
    target: 'weird-tool',
    icon: 'tool',
  });
});

test('reasoning is labelled as reasoning whatever the provider called it', () => {
  assert.deepEqual(
    describe({ kind: 'reasoning', title: 'OpenCode', text: 'Weighing options\nthen' }),
    {
      verb: 'Reasoning',
      target: 'Weighing options …',
      icon: 'think',
    },
  );
});

test('MCP tools read as server and call', () => {
  assert.deepEqual(describe({ title: 'mcp__github__create_issue' }), {
    verb: 'create issue',
    target: 'github',
    icon: 'tool',
  });
});

test('consecutive tool and reasoning rows fold into one block, other kinds stand alone', () => {
  const groups = plain(
    groupAgentTranscript([
      item({ id: 'a', kind: 'assistant', text: 'Starting' }),
      item({ id: 'b', kind: 'reasoning', title: 'OpenCode' }),
      item({ id: 'c', title: 'Read', status: 'running' }),
      item({ id: 'd', kind: 'notice', title: 'Agent mode' }),
      item({ id: 'e', title: 'Bash', status: 'failed' }),
    ]),
  );
  assert.deepEqual(
    groups.map((group) =>
      group.kind === 'activity' ? group.items.map((entry) => entry.id) : group.item.id,
    ),
    ['a', ['b', 'c'], 'd', ['e']],
  );
  assert.equal(groups[1].running, true);
  assert.equal(groups[3].failed, 1);
});

test('a collapsed block names a single new file and leads with what changed', () => {
  assert.equal(
    summarizeAgentActivity([
      item({ kind: 'reasoning', title: 'OpenCode', text: 'Planning' }),
      item({ title: 'Read', text: '{"file_path":"src/Api/Startup.cs"}' }),
      item({ title: 'Write', text: '{"file_path":"src/Api/ByokEndpoints.cs","content":"a\\nb"}' }),
      item({ title: 'Bash', text: '{"command":"dotnet build"}' }),
      item({ title: 'Bash', text: '{"command":"dotnet test"}' }),
      item({ title: 'Bash', text: '{"command":"git status"}' }),
    ]),
    'Created ByokEndpoints.cs, ran 3 commands',
  );
});

test('a collapsed block keeps reads and thoughts when nothing changed, and reports failures', () => {
  assert.equal(
    summarizeAgentActivity([
      item({ kind: 'reasoning', title: 'OpenCode', text: 'Planning' }),
      item({ title: 'Read', text: '{"file_path":"a.cs"}' }),
      item({ title: 'Read', text: '{"file_path":"b.cs"}', status: 'failed' }),
    ]),
    'Read 2 files, thought it through, 1 failed',
  );
});

test('a step reports the lines it asked to add and remove', () => {
  assert.deepEqual(
    plain(agentActivityChange(item({ title: 'Write', text: '{"content":"a\\nb\\nc"}' }))),
    {
      added: 3,
      removed: 0,
    },
  );
  assert.deepEqual(
    plain(
      agentActivityChange(
        item({ title: 'Edit', text: '{"input":{"oldString":"a\\nb","newString":"c"}}' }),
      ),
    ),
    { added: 1, removed: 2 },
  );
  assert.deepEqual(
    plain(
      agentActivityChange(
        item({
          title: 'MultiEdit',
          text: '{"edits":[{"old_string":"a","new_string":"b"},{"old_string":"c","new_string":"d"}]}',
        }),
      ),
    ),
    { added: 2, removed: 2 },
  );
  assert.equal(agentActivityChange(item({ title: 'Bash', text: '{"command":"ls"}' })), null);
});

test('a patch is counted by its hunks, not by its file headers', () => {
  assert.deepEqual(
    plain(
      agentActivityChange(
        item({
          title: 'apply_patch',
          text: JSON.stringify({ patch: '--- a.cs\n+++ a.cs\n-old\n+new\n+extra\n done' }),
        }),
      ),
    ),
    { added: 2, removed: 1 },
  );
});

test('a block totals the lines its steps changed', () => {
  assert.deepEqual(
    plain(
      sumAgentActivityChange([
        item({ title: 'Write', text: '{"content":"a\\nb"}' }),
        item({ title: 'Edit', text: '{"oldString":"x","newString":"y"}' }),
        item({ title: 'Bash', text: '{"command":"ls"}' }),
      ]),
    ),
    { added: 3, removed: 1 },
  );
  assert.equal(sumAgentActivityChange([item({ title: 'Bash', text: '{"command":"ls"}' })]), null);
});

test('an edit expands into removed and added lines; a command has no diff', () => {
  assert.deepEqual(
    plain(
      agentActivityDiff(item({ title: 'Edit', text: '{"oldString":"old","newString":"new"}' })),
    ),
    {
      lines: [
        { sign: '-', text: 'old' },
        { sign: '+', text: 'new' },
      ],
      truncated: false,
    },
  );
  assert.equal(agentActivityDiff(item({ title: 'Bash', text: '{"command":"ls"}' })), null);
});

test('the full-screen viewer gets a unified diff the shared parser can read', () => {
  const patch = agentActivityPatch(
    item({ title: 'Edit', text: '{"oldString":"old\\nbits","newString":"new"}' }),
    'src/Api/Program.cs',
  );
  assert.equal(
    patch,
    ['--- a/src/Api/Program.cs', '+++ b/src/Api/Program.cs', '@@', '-old', '-bits', '+new'].join(
      '\n',
    ),
  );
  assert.equal(agentActivityPatch(item({ title: 'Bash', text: '{"command":"ls"}' })), null);
});

test('the viewer shows a path relative to the task working directory', () => {
  assert.equal(agentActivityRelativePath('/repo/src/a.cs', '/repo'), 'src/a.cs');
  assert.equal(agentActivityRelativePath('/repo/src/a.cs', '/repo/'), 'src/a.cs');
  assert.equal(agentActivityRelativePath('/elsewhere/a.cs', '/repo'), '/elsewhere/a.cs');
  assert.equal(agentActivityRelativePath('src/a.cs'), 'src/a.cs');
});
