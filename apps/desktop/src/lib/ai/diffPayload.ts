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
 *
 * Two surfaces share this module:
 *   • Per-file: {@link buildDiffChatPayload} — used by `DiffPane`'s
 *     Explain button, drills into one file's hunks.
 *   • Per-commit / per-changeset: {@link buildCommitChatPayload} —
 *     used by `HistoryPanel` (and similar) to ask the model about a
 *     whole commit at once, so the user doesn't have to walk every
 *     file individually for a single coherent answer.
 *
 * The two payloads are intentionally distinct: a single-file prompt
 * frames the question as "what does this hunk do?", a commit prompt
 * frames it as "what is this commit *for*?" — different scope, so
 * different system message, draft prompt, and even truncation budget.
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
/** Larger budget for whole-commit prompts — a 6-file refactor easily
 *  exceeds 16 KB, but the commit-level question genuinely needs the
 *  full picture to be answered well. We still cap so a 5k-LOC vendor
 *  bump can't blow the context window; the per-file Explain remains
 *  the right tool for those.
 *
 *  32 KB ≈ 8k tokens at 4 bytes/token, comfortable for any model with
 *  at least a 16k context (every reasonable local 7B+ qualifies). */
const MAX_COMMIT_DIFF_CHARS = 32_000;
/** Per-file slice ceiling inside an aggregated commit payload. Without
 *  this a single bloated `pnpm-lock.yaml` would eat the whole budget
 *  and starve the rest of the files. We give every file a fair share
 *  first, then let the trailing budget mop up extras. */
const MAX_PER_FILE_CHARS_IN_COMMIT = 6_000;

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

/** A single file inside an aggregated commit/changeset payload. The
 *  caller is responsible for fetching the per-file diff text (e.g.
 *  via `git_diff_commit_file` for history, `git_diff_file` for the
 *  working tree); this builder concatenates them and writes the
 *  framing prompt. */
export interface CommitChatPayloadFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** Raw unified-diff text for this file. Empty string is allowed
   *  (e.g. binary files we skipped) — the file still appears in the
   *  metadata header, with a `[binary or empty diff]` marker in the
   *  body so the model knows we didn't drop the change silently. */
  diff: string;
}

export interface CommitChatPayloadInput {
  /** "commit" for git history, "changeset" for the uncommitted working
   *  tree. Drives wording of the prompt + title + context kind. */
  scope: 'commit' | 'changeset';
  /** Optional commit metadata; required for `scope: 'commit'`. The
   *  changeset variant has no commit yet, so we fall back to a generic
   *  "uncommitted changes" framing. */
  commit?: {
    hashShort: string;
    hashFull: string;
    subject: string;
    author: string;
    /** Unix seconds. */
    timestamp: number;
  };
  files: CommitChatPayloadFile[];
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Build a commit-level (or working-tree-level) Explain payload.
 *
 * The shape of the returned `DiffChatPayload` matches
 * {@link buildDiffChatPayload}, so both surfaces hand off to the same
 * `useAiSurfaceTrigger`/`openAiChat` plumbing — only the contents and
 * framing differ.
 */
export function buildCommitChatPayload(input: CommitChatPayloadInput): DiffChatPayload {
  const { scope, commit, files, totalAdditions, totalDeletions } = input;

  // Per-file slicing first, then a final whole-payload trim. The two
  // limits compose so neither a single bloated lockfile nor a
  // collectively bloated dump can starve the model context.
  const slicedFiles = files.map((f) => {
    const isOversize = f.diff.length > MAX_PER_FILE_CHARS_IN_COMMIT;
    const body =
      f.diff.length === 0
        ? '[binary or empty diff — file changed but no text content shown]'
        : isOversize
          ? `${f.diff.slice(0, MAX_PER_FILE_CHARS_IN_COMMIT)}\n[file diff truncated by RunHQ — only the leading hunks were sent]`
          : f.diff;
    return { ...f, body, perFileTruncated: isOversize };
  });

  // Stable order: by path so the model sees a deterministic layout
  // regardless of how git decided to enumerate them. Helps when the
  // user re-asks the same commit later and expects the same output.
  slicedFiles.sort((a, b) => a.path.localeCompare(b.path));

  const fileBlocks = slicedFiles.map((f) => {
    return [
      `=== ${f.path} ===`,
      `status: ${f.status}  +${f.additions} -${f.deletions}${f.perFileTruncated ? '  (truncated)' : ''}`,
      '```diff',
      f.body,
      '```',
    ].join('\n');
  });

  // Concatenate, then trim once more if the aggregate is still too
  // large. Stamping the marker at the boundary keeps the model honest
  // about what it didn't see — better than silent truncation.
  let aggregated = fileBlocks.join('\n\n');
  let aggregateTruncated = false;
  if (aggregated.length > MAX_COMMIT_DIFF_CHARS) {
    aggregated = `${aggregated.slice(0, MAX_COMMIT_DIFF_CHARS)}\n[changeset truncated by RunHQ — trailing files were dropped to fit the model budget]`;
    aggregateTruncated = true;
  }

  // Header — meta block the model uses to anchor its summary. We
  // emit it as plain key:value lines so it survives any trimming
  // applied to the diff body underneath.
  const headerLines: string[] = [];
  if (scope === 'commit' && commit) {
    headerLines.push(
      `Commit: ${commit.hashShort} — ${commit.subject}`,
      `Author: ${commit.author}`,
      `When: ${new Date(commit.timestamp * 1000).toISOString()}`,
    );
  } else {
    headerLines.push('Scope: uncommitted changes (working tree + index)');
  }
  headerLines.push(`Files: ${files.length}  total +${totalAdditions} -${totalDeletions}`);

  const scopeNoun = scope === 'commit' ? 'commit' : 'changeset';
  const draftScope = scope === 'commit' ? 'this commit' : 'these uncommitted changes';

  // System message is structurally similar to the per-file one but
  // asks for a *coherent* commit-level narrative. The model should
  // describe intent first ("why was this change made?") and only
  // then enumerate the per-file specifics. Without that nudge,
  // models default to a flat per-file recap that buries the lede.
  const contextSystemMessage = [
    `User clicked "Explain ${scopeNoun}" in RunHQ. The user wants to understand the ${scopeNoun} as a whole, not a file-by-file recap. Write plain English in GitHub-flavoured Markdown — clarity over completeness. Lead with a single bold sentence stating the intent of the ${scopeNoun} (the *why*, not just the *what*). Follow it with up to six short bullets covering the substantive changes; group related files into one bullet when they share intent (e.g. "rename foo→bar across X.cs / Y.cs / Z.cs"). If there are real risks (nullability, missing tests, breaking changes, perf regressions, security-adjacent edits), add a brief **Review concerns** section; otherwise omit it. Reference real symbols and file paths from the diff when they help. Never invent code or files that aren't in the diff. Never wrap your final answer in code fences.`,
    '',
    headerLines.join('\n'),
    '',
    aggregated,
  ].join('\n');

  const title =
    scope === 'commit' && commit
      ? `Commit · ${commit.hashShort}`
      : `Changeset · ${files.length} file${files.length === 1 ? '' : 's'}`;

  return {
    title,
    context: {
      kind: scope === 'commit' ? 'commit_diff' : 'changeset_diff',
      commit_hash: commit?.hashFull,
      commit_short: commit?.hashShort,
      file_count: files.length,
      total_additions: totalAdditions,
      total_deletions: totalDeletions,
      diff_chars: aggregated.length,
      truncated: aggregateTruncated,
      per_file_truncated: slicedFiles.filter((f) => f.perFileTruncated).map((f) => f.path),
    },
    draftPrompt: `Explain ${draftScope}.`,
    contextSystemMessage,
  };
}
