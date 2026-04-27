/**
 * Build the chat-panel payload for "explain this diff" — the Phase-4
 * replacement for the inline AI explainer that lived inside DiffPane.
 *
 * The legacy implementation streamed via `ai_explain_diff`, which had
 * its own dedicated prompt builder in Rust. We mirror that behaviour
 * here in TS so the chat-panel route gets the same evidence and the
 * same framing — leading bold summary, ≤5 bullets, optional risks
 * section.
 *
 * Diffs can be huge (a 5k-line refactor will easily blow the model's
 * context). We trim aggressively, keep the leading hunks, and stamp a
 * "[diff truncated]" marker so the model knows.
 */
export interface DiffChatPayloadInput {
  diff: string;
  filePath: string | null;
  /** When true, the prompt frames the request as "explain the
   *  selected hunk" rather than "explain the diff for this file".
   *  Currently always false from DiffPane (no selection mode), but
   *  reserved for future per-hunk Explain affordances. */
  selectionOnly?: boolean;
}

export interface DiffChatPayload {
  title: string;
  context: Record<string, unknown>;
  draftPrompt: string;
  contextSystemMessage: string;
}

const MAX_DIFF_CHARS = 16_000;

export function buildDiffChatPayload(input: DiffChatPayloadInput): DiffChatPayload {
  const { diff, filePath, selectionOnly = false } = input;
  let trimmed = diff;
  let truncated = false;
  if (trimmed.length > MAX_DIFF_CHARS) {
    trimmed = `${trimmed.slice(0, MAX_DIFF_CHARS)}\n[diff truncated by RunHQ — only the leading hunks were sent]`;
    truncated = true;
  }

  const scope = selectionOnly
    ? 'the selected hunk'
    : filePath
      ? 'the diff for one file'
      : 'the diff';

  const filePart = filePath ? `File: \`${filePath}\`\n\n` : '';

  const contextSystemMessage = [
    'User clicked "Explain" on a diff in RunHQ. Write plain English in GitHub-flavoured Markdown — clarity over completeness. Lead with a one-line bold summary of the diff. Follow it with up to five short bullets describing the actual changes. If there are real risks (nullability, missing tests, off-by-ones, breaking changes), add a brief **Review concerns** section; otherwise omit it. Reference the real symbols and file paths from the diff when they help. Never invent code that isn\'t in the diff. Never wrap your final answer in code fences.',
    '',
    `${filePart}\`\`\`diff`,
    trimmed,
    '```',
  ].join('\n');

  // Keep the title compact — diffs can have long paths. The History
  // drawer will further truncate but giving it a short label up
  // front avoids ambiguous "Diff" entries.
  const baseName = filePath ? (filePath.split('/').pop() ?? filePath) : 'changes';
  const title = `Diff · ${baseName}`;

  return {
    title,
    context: {
      kind: 'diff',
      file_path: filePath,
      selection_only: selectionOnly,
      diff_chars: diff.length,
      truncated,
    },
    draftPrompt: `Explain ${scope}.`,
    contextSystemMessage,
  };
}
