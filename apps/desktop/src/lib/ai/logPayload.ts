/**
 * Build the chat-panel payload for "explain this log line" — the
 * Phase-4 replacement for the standalone `LogTriagePopover`.
 *
 * Mirrors the prior IPC-side prompt: include the offending line, ±30
 * surrounding lines, the runtime, and the service. Past that, the
 * model gets the same evidence whether the request comes from the
 * legacy popover or the new chat surface — only the routing
 * changes.
 *
 * We push the noisy log buffer into a fenced code block in the
 * system context and keep the user-visible draft prompt short. The
 * user can tweak it before sending if they want a different angle
 * ("compare to last successful run", "is this fatal?").
 */
export interface LogChatPayloadInput {
  line: string;
  contextLines: string[];
  runtime: string | null;
  serviceName: string | null;
}

export interface LogChatPayload {
  title: string;
  context: Record<string, unknown>;
  draftPrompt: string;
  contextSystemMessage: string;
}

const MAX_LOG_CONTEXT_CHARS = 6000;

export function buildLogChatPayload(input: LogChatPayloadInput): LogChatPayload {
  const { line, contextLines, runtime, serviceName } = input;
  // Trim the surrounding buffer if it would blow the prompt budget.
  // We keep the LATEST lines (which include the offending one) and
  // chop from the top — older lines tend to be less informative for
  // diagnosing the most recent error.
  let joined = contextLines.join('\n');
  if (joined.length > MAX_LOG_CONTEXT_CHARS) {
    joined = `[earlier lines truncated]\n…\n${joined.slice(joined.length - MAX_LOG_CONTEXT_CHARS)}`;
  }

  const headerBits: string[] = [];
  if (serviceName) headerBits.push(`service: \`${serviceName}\``);
  if (runtime) headerBits.push(`runtime: \`${runtime}\``);
  const header = headerBits.length
    ? `User right-clicked a log line in RunHQ. ${headerBits.join(' · ')}.`
    : 'User right-clicked a log line in RunHQ.';

  const contextSystemMessage = [
    header,
    '',
    'Offending line:',
    '```',
    line,
    '```',
    '',
    'Surrounding log buffer (most recent at the bottom):',
    '```',
    joined,
    '```',
    '',
    'Explain what this means and the most likely cause. If there is a clear fix, give the exact command or code change. Be specific to the runtime when relevant.',
  ].join('\n');

  // Title kept short so it lays out nicely in the History drawer.
  const titleLine = line.length > 80 ? `${line.slice(0, 77)}…` : line;
  const title = serviceName ? `Log · ${serviceName}: ${titleLine}` : `Log: ${titleLine}`;

  return {
    title,
    context: {
      kind: 'log',
      runtime,
      service_name: serviceName,
      line,
      context_line_count: contextLines.length,
    },
    draftPrompt: 'What does this log line mean and how do I fix it?',
    contextSystemMessage,
  };
}
