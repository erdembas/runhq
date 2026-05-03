import type { editor as MonacoEditor } from 'monaco-editor';

export function wrapSelection(
  editor: MonacoEditor.IStandaloneCodeEditor,
  prefix: string,
  suffix: string,
  placeholder: string,
): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;
  const selected = model.getValueInRange(selection);
  if (
    selected.length >= prefix.length + suffix.length &&
    selected.startsWith(prefix) &&
    selected.endsWith(suffix)
  ) {
    const inner = selected.slice(prefix.length, selected.length - suffix.length);
    editor.executeEdits('markdown-toggle', [
      { range: selection, text: inner, forceMoveMarkers: true },
    ]);
    return;
  }
  const inner = selected.length > 0 ? selected : placeholder;
  const replacement = `${prefix}${inner}${suffix}`;
  editor.executeEdits('markdown-toggle', [
    { range: selection, text: replacement, forceMoveMarkers: true },
  ]);
  if (selected.length === 0) {
    const startCol = selection.startColumn + prefix.length;
    const endCol = startCol + inner.length;
    editor.setSelection({
      startLineNumber: selection.startLineNumber,
      startColumn: startCol,
      endLineNumber: selection.startLineNumber,
      endColumn: endCol,
    });
  }
  editor.focus();
}

export function insertLink(editor: MonacoEditor.IStandaloneCodeEditor): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;
  const selected = model.getValueInRange(selection);
  const looksLikeUrl = /^(https?:\/\/|mailto:|\/)/i.test(selected.trim());
  const text = looksLikeUrl ? 'link text' : selected || 'link text';
  const url = looksLikeUrl ? selected.trim() : 'https://';
  const replacement = `[${text}](${url})`;
  editor.executeEdits('markdown-link', [
    { range: selection, text: replacement, forceMoveMarkers: true },
  ]);
  const startLine = selection.startLineNumber;
  const startCol = looksLikeUrl
    ? selection.startColumn + 1
    : selection.startColumn + replacement.indexOf('](') + 2;
  const endCol = looksLikeUrl
    ? startCol + text.length
    : selection.startColumn + replacement.length - 1;
  editor.setSelection({
    startLineNumber: startLine,
    startColumn: startCol,
    endLineNumber: startLine,
    endColumn: endCol,
  });
  editor.focus();
}

export function toggleLinePrefix(editor: MonacoEditor.IStandaloneCodeEditor, prefix: string): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;
  const startLine = selection.startLineNumber;
  const endLine = selection.endLineNumber;
  let allPrefixed = true;
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    const text = model.getLineContent(lineNumber);
    if (text.length === 0) continue;
    if (!text.startsWith(prefix)) {
      allPrefixed = false;
      break;
    }
  }
  const edits: MonacoEditor.IIdentifiedSingleEditOperation[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    const text = model.getLineContent(lineNumber);
    const range = {
      startLineNumber: lineNumber,
      startColumn: 1,
      endLineNumber: lineNumber,
      endColumn: text.length + 1,
    };
    if (allPrefixed) {
      edits.push({ range, text: text.slice(prefix.length), forceMoveMarkers: true });
    } else if (text.length === 0 || !text.startsWith(prefix)) {
      edits.push({ range, text: prefix + text, forceMoveMarkers: true });
    }
  }
  if (edits.length > 0) {
    editor.executeEdits('markdown-line-prefix', edits);
  }
  editor.focus();
}

export function toggleHeading(editor: MonacoEditor.IStandaloneCodeEditor): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;
  const line = selection.startLineNumber;
  const text = model.getLineContent(line);
  const match = text.match(/^(#{1,6})\s+(.*)$/);
  let next: string;
  if (!match) {
    next = `# ${text}`;
  } else {
    const level = match[1]!.length;
    const body = match[2]!;
    next = level >= 3 ? body : `${'#'.repeat(level + 1)} ${body}`;
  }
  editor.executeEdits('markdown-heading', [
    {
      range: {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: text.length + 1,
      },
      text: next,
      forceMoveMarkers: true,
    },
  ]);
  editor.focus();
}
