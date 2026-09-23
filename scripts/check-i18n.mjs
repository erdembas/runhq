import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = (locale) =>
  JSON.parse(readFileSync(path.join(root, `packages/cockpit-ui/src/i18n/${locale}.json`), 'utf8'));
const en = catalog('en');
const tr = catalog('tr');
const failures = [];
const placeholders = (value) =>
  [...new Set([...value.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((match) => match[1]))]
    // Existing migrated English suffixes have no Turkish equivalent. New copy uses plural().
    .filter((name) => !/^plural\d+$/.test(name))
    .sort();
for (const [key, value] of Object.entries(en)) {
  if (!Object.hasOwn(tr, key)) failures.push(`Missing Turkish translation: ${key}`);
  else if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(tr[key])))
    failures.push(`Placeholder mismatch: ${key}`);
}
for (const key of Object.keys(tr))
  if (!Object.hasOwn(en, key)) failures.push(`Missing English translation: ${key}`);

const exceptions = JSON.parse(
  readFileSync(path.join(root, 'scripts/i18n-exceptions.json'), 'utf8'),
);
const visibleProperties = new Set(
  'label title description message placeholder aria-label aria-description alt tooltip hint emptyText emptyMessage loadingText confirmLabel cancelLabel submitLabel searchPlaceholder noResultsText body detail subtitle heading summary footerText reason caption eyebrow empty'.split(
    ' ',
  ),
);
const files = [];
const historicalRelease =
  /\/lib\/whatsnew\/data\/(?:0\.6\.0|0\.7\.0|0\.9\.0|0\.10\.0|0\.10\.3|2\.0\.0|2\.2\.0)(?:\/|\.tsx?$)/;
function collect(directory) {
  for (const item of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const filename = `${directory}/${item.name}`;
    if (historicalRelease.test(filename)) continue;
    if (item.isDirectory()) {
      if (!filename.endsWith('/i18n')) collect(filename);
    } else if (/\.tsx?$/.test(filename) && !item.name.startsWith('__qa')) files.push(filename);
  }
}
collect('apps/desktop/src');
collect('packages/cockpit-ui/src');
const findings = [];
const human = (value) =>
  /\p{L}{2}/u.test(value.replace(/&[a-z]+;/gi, '')) &&
  !/^(?:rgba?\(|text-\[)/.test(value) &&
  !/^(?:https?:|data:|\/?[\w.-]+\/|#[\da-f]+$)/.test(value);
for (const filename of files) {
  const source = readFileSync(path.join(root, filename), 'utf8');
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  function displayContext(node) {
    const parent = node.parent;
    if (ts.isJsxAttribute(parent)) return visibleProperties.has(parent.name.getText(sf));
    if (ts.isPropertyAssignment(parent))
      return (
        parent.initializer === node &&
        visibleProperties.has(parent.name.getText(sf).replace(/['"]/g, ''))
      );
    if (ts.isParenthesizedExpression(parent)) return displayContext(parent);
    if (ts.isTemplateSpan(parent) && parent.expression === node)
      return displayContext(parent.parent);
    if (ts.isConditionalExpression(parent) && parent.condition !== node)
      return displayContext(parent);
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === node &&
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
      ].includes(parent.operatorToken.kind)
    )
      return displayContext(parent);
    if (ts.isJsxExpression(parent))
      return (
        !ts.isJsxAttribute(parent.parent) || visibleProperties.has(parent.parent.name.getText(sf))
      );
    if (ts.isParameter(parent) || ts.isBindingElement(parent))
      return visibleProperties.has(parent.name.getText(sf));
    if (ts.isCallExpression(parent))
      return /(?:^|\.)(setError|setMessage|setNotice|setStatusMessage|alert|confirm|notify)$/.test(
        parent.expression.getText(sf),
      );
    return false;
  }
  function visit(node) {
    if (
      ts.isJsxElement(node) &&
      ['code', 'pre', 'kbd', 'script', 'style'].includes(node.openingElement.tagName.getText(sf))
    )
      return;
    let value;
    if (ts.isJsxText(node)) value = node.text.replace(/\s+/g, ' ').trim();
    else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      displayContext(node)
    )
      value = node.text;
    else if (ts.isTemplateExpression(node) && displayContext(node))
      value = node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
    if (value && human(value)) {
      const allow = exceptions[filename]?.[value];
      if (!allow) {
        findings.push({
          file: filename,
          value,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        });
        failures.push(
          `${filename}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: uncatalogued UI text: ${value}`,
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

// Native menu/window/dialog copy shares the same catalog as the React UI.
function checkNative(directory) {
  for (const item of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const filename = `${directory}/${item.name}`;
    if (item.isDirectory()) checkNative(filename);
    else if (filename.endsWith('.rs')) {
      const source = readFileSync(path.join(root, filename), 'utf8');
      for (const match of source.matchAll(/(?:localize|localize_for)\([^;\n]*?,\s*"([^"]+)"/g)) {
        if (!Object.hasOwn(en, match[1]))
          failures.push(`${filename}: missing native catalog key: ${match[1]}`);
      }
      for (const match of source.matchAll(
        /\.(?:title|set_title|body|message|add_filter)\(\s*"([^"]+)"/g,
      )) {
        if (human(match[1]) && match[1] !== 'RunHQ')
          failures.push(`${filename}: uncatalogued native UI text: ${match[1]}`);
      }
      for (const match of source.matchAll(/MenuItem::with_id\(\s*\w+,\s*"[^"]+",\s*"([^"]+)"/g)) {
        if (human(match[1])) failures.push(`${filename}: uncatalogued menu text: ${match[1]}`);
      }
    }
  }
}
checkNative('apps/desktop/src-tauri/src');
if (process.argv.includes('--json')) console.log(JSON.stringify(findings, null, 2));
else if (failures.length) console.error(failures.join('\n'));
else
  console.log(
    `i18n OK: ${Object.keys(en).length} English/Turkish messages; ${files.length} source files checked.`,
  );
if (failures.length) process.exitCode = 1;
