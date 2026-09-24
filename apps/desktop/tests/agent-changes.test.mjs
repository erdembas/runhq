import { URL } from 'node:url';
import { TextEncoder, TextDecoder } from 'node:util';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL('../src/components/agents/agentChanges.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports, TextEncoder, TextDecoder },
);
const { parseAgentChanges, agentChangeLines } = exports;

test('keeps distant hunks separate and uses their real old and new source positions', () => {
  const rows = agentChangeLines(`diff --git a/file b/file
--- a/file
+++ b/file
@@ -12,2 +12,3 @@ first
 context
-old
+new
+inserted
@@ -120,0 +122,1 @@ distant
+last
\\ No newline at end of file
`);
  assert.equal(rows.length, 8);
  assert.equal(rows[0].kind, 'hunk');
  assert.equal(rows[1].before, 12);
  assert.equal(rows[1].after, 12);
  assert.equal(rows[2].before, 13);
  assert.equal(rows[2].after, undefined);
  assert.equal(rows[3].before, undefined);
  assert.equal(rows[3].after, 13);
  assert.equal(rows[4].after, 14);
  assert.equal(rows[5].kind, 'hunk');
  assert.equal(rows[5].text, '@@ -120,0 +122,1 @@ distant');
  assert.equal(rows[6].after, 122);
  assert.equal(rows[7].kind, 'metadata');
});

test('splits complete patches and counts content across hunks without counting headers', () => {
  const edited = `diff --git a/src/file.ts b/src/file.ts
index aaaa..bbbb 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,2 +1,2 @@
-before
+after
 unchanged
@@ -10 +10,2 @@
-removed
+++content beginning with plus signs
+diff --git a/not-a-file b/not-a-file
\\ No newline at end of file
`;
  const deleted = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-old
`;
  const added = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+new
`;
  const files = parseAgentChanges(edited + deleted + added);
  assert.equal(files.length, 3);
  assert.equal(files[0].patch, edited);
  assert.equal(files[0].path, 'src/file.ts');
  assert.equal(files[0].additions, 3);
  assert.equal(files[0].deletions, 2);
  assert.equal(files[1].path, 'gone.ts');
  assert.equal(files[1].status, 'deleted');
  assert.equal(files[2].status, 'added');
  assert.equal(files[2].additions, 1);
});

test('handles filenames with spaces, quoted UTF-8 bytes, tabs and quotes', () => {
  const diff = String.raw`diff --git a/folder with spaces/file.ts b/folder with spaces/file.ts
--- a/folder with spaces/file.ts	
+++ b/folder with spaces/file.ts	
@@ -1 +1 @@
-old
+new
diff --git "a/\304\260sim\t\"quoted\".ts" "b/\304\260sim\t\"quoted\".ts"
--- "a/\304\260sim\t\"quoted\".ts"
+++ "b/\304\260sim\t\"quoted\".ts"
@@ -1 +1 @@
-old
+new
`.replaceAll('file.ts\\t', 'file.ts\t');
  const files = parseAgentChanges(diff);
  assert.equal(files[0].path, 'folder with spaces/file.ts');
  assert.equal(files[1].path, 'İsim\t"quoted".ts');
});

test('keeps binary, mode-only, rename-only and copy-only files visible without text hunks', () => {
  const files = parseAgentChanges(`diff --git a/a b/image.png b/a b/image.png
index aaaa..bbbb 100644
Binary files a/a b/image.png and b/a b/image.png differ
diff --git a/run script b/run script
old mode 100644
new mode 100755
diff --git a/old name b/new name
similarity index 100%
rename from old name
rename to new name
diff --git a/old.ts b/copied.ts
similarity index 100%
copy from old.ts
copy to copied.ts
`);
  assert.equal(files.length, 4);
  assert.equal(files[0].path, 'a b/image.png');
  assert.equal(files[0].additions, 0);
  assert.equal(files[1].path, 'run script');
  assert.equal(files[2].path, 'new name');
  assert.equal(files[2].status, 'renamed');
  assert.equal(files[3].status, 'copied');
  assert.equal(files[3].path, 'copied.ts');
  assert.equal(parseAgentChanges('').length, 0);
});
