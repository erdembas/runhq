import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import {
  pretty,
  questionsFrom,
  requireAnswers,
  elicitationView,
  elicitationResponse,
} from './protocol.mjs';
import { claudeImageInput, validateAttachments } from './attachments.mjs';

export async function runClaude(ctx, catalog = false, queryProvider = query) {
  const cfg = ctx.config;
  const attachments = catalog ? [] : validateAttachments(cfg.attachments, 'claude');
  const controller = new AbortController();
  // SDK integrations use supported API authentication; do not copy CLI OAuth tokens.
  const env = { ...process.env };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const options = {
    cwd: cfg.cwd,
    pathToClaudeCodeExecutable: cfg.executable,
    abortController: controller,
    includePartialMessages: true,
    settingSources: ['user', 'project', 'local'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    permissionMode: cfg.read_only_review || cfg.mode === 'plan' ? 'plan' : 'default',
    ...(cfg.read_only_review
      ? { disallowedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'Agent', 'Task'] }
      : {}),
    model: cfg.model || undefined,
    effort: cfg.effort || undefined,
    resume: cfg.native_id || undefined,
    agent: cfg.agent || undefined,
    env,
    onElicitation: (request, { signal, requestId }) =>
      new Promise((resolve, reject) => {
        const id = `elicitation-${requestId}`;
        const onAbort = () => {
          ctx.resolve(id);
          resolve({ action: 'cancel' });
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        ctx
          .ask({ id, ...elicitationView(request) }, async (value) => {
            const response = elicitationResponse(value);
            signal.removeEventListener('abort', onAbort);
            resolve(response);
          })
          .catch(reject);
      }),
    canUseTool: async (name, input, context) =>
      new Promise((resolve, reject) => {
        const id = context.toolUseID ?? randomUUID();
        if (
          cfg.read_only_review &&
          ![
            'Read',
            'Glob',
            'Grep',
            'LS',
            'WebFetch',
            'WebSearch',
            'ToolSearch',
            'AskUserQuestion',
          ].includes(name)
        ) {
          resolve({
            behavior: 'deny',
            message:
              'Workflow reviewers can inspect files but cannot change the workspace or run commands.',
          });
          return;
        }
        const isQuestion = name === 'AskUserQuestion';
        const questions = isQuestion ? questionsFrom(input.questions) : [];
        const onAbort = () => {
          ctx.resolve(id);
          reject(new Error('Request cancelled'));
        };
        context.signal.addEventListener('abort', onAbort, { once: true });
        ctx
          .ask(
            {
              id,
              kind: isQuestion ? 'question' : 'approval',
              title: isQuestion ? 'Claude needs your input' : `Allow ${name}?`,
              questions,
              details: pretty(input),
              choices: isQuestion
                ? []
                : [
                    { label: 'Allow once', value: 'accept' },
                    { label: 'Deny', value: 'decline' },
                  ],
            },
            async (value) => {
              if (isQuestion && !value.reject) {
                const answers = requireAnswers(questions, value);
                context.signal.removeEventListener('abort', onAbort);
                resolve({
                  behavior: 'allow',
                  updatedInput: {
                    ...input,
                    answers: Object.fromEntries(
                      Object.entries(answers).map(([key, values]) => [key, values.join(', ')]),
                    ),
                  },
                });
              } else {
                if (!value.reject && !['accept', 'decline'].includes(value.decision))
                  throw new Error('Invalid decision');
                context.signal.removeEventListener('abort', onAbort);
                resolve(
                  value.decision === 'accept'
                    ? { behavior: 'allow', updatedInput: input }
                    : { behavior: 'deny', message: 'The user declined this request.' },
                );
              }
            },
          )
          .catch(reject);
      }),
  };
  // A suspended input generator initializes the SDK for discovery without sending a model request.
  let releaseInput;
  async function* emptyInput() {
    await new Promise((resolve) => {
      releaseInput = resolve;
    });
  }
  const q = queryProvider({
    prompt: catalog
      ? emptyInput()
      : attachments.length
        ? claudeImageInput(cfg.prompt, attachments)
        : cfg.prompt,
    options,
  });
  ctx.interrupt = async () => {
    ctx.cancelled = true;
    controller.abort();
  };
  try {
    if (catalog) {
      const [models, commands] = await Promise.all([q.supportedModels(), q.supportedCommands()]);
      return {
        models: models.map((m) => ({
          id: m.value,
          name: m.displayName,
          description: m.description,
          resolved_model: m.resolvedModel,
          is_alias:
            /^(default|opus|sonnet|haiku|opusplan)(\[1m\])?$/.test(m.value) ||
            (!!m.resolvedModel && m.resolvedModel !== m.value),
          efforts: m.supportedEffortLevels ?? [],
        })),
        agents: [],
        commands: commands.map((c) => c.name),
        modes: ['default', 'plan'],
        can_steer: false,
      };
    }
    ctx.emit({ type: 'status', status: 'running' });
    let blockId = '';
    let blockIndex = 0;
    let result;
    for await (const message of q) {
      if (message.session_id && !message.parent_tool_use_id)
        ctx.emit({ type: 'native', id: message.session_id });
      if (message.type === 'stream_event') {
        const e = message.event;
        if (e.type === 'message_start') blockId = e.message.id;
        if (e.type === 'content_block_start') {
          blockIndex = e.index;
          const b = e.content_block;
          if (b.type === 'tool_use') ctx.item(b.id, 'tool', b.name, pretty(b.input), 'running');
        }
        if (e.type === 'content_block_delta' && e.delta.type === 'text_delta')
          ctx.delta(`${blockId}-${e.index ?? blockIndex}`, 'assistant', e.delta.text, 'Claude');
      }
      if (message.type === 'assistant') {
        for (const [index, block] of message.message.content.entries()) {
          if (block.type === 'text')
            ctx.item(`${message.message.id}-${index}`, 'assistant', 'Claude', block.text);
          if (block.type === 'tool_use')
            ctx.item(block.id, 'tool', block.name, pretty(block.input), 'running');
        }
      }
      if (message.type === 'user' && Array.isArray(message.message.content)) {
        for (const block of message.message.content)
          if (block.type === 'tool_result') {
            const item = ctx.items.get(block.tool_use_id);
            ctx.item(
              block.tool_use_id,
              'tool',
              item?.title ?? 'Tool result',
              `${item?.text ?? ''}\n\n${pretty(block.content)}`,
              block.is_error ? 'failed' : 'completed',
            );
          }
      }
      if (message.type === 'system' && message.subtype === 'permission_denied')
        ctx.item(message.uuid, 'notice', 'Permission denied', pretty(message), 'failed');
      if (
        message.type === 'system' &&
        ['task_started', 'task_progress', 'task_notification'].includes(message.subtype)
      )
        ctx.item(
          message.task_id ?? message.uuid,
          'tool',
          message.description ?? 'Subagent',
          pretty(message),
          message.status ?? 'running',
        );
      if (message.type === 'result') {
        ctx.emit({
          type: 'usage',
          usage: {
            usage: message.usage,
            cost_usd: message.total_cost_usd,
            model_usage: message.modelUsage,
          },
        });
        result = {
          status: message.is_error ? 'failed' : 'completed',
          error: message.is_error ? (message.errors ?? []).join('\n') : undefined,
        };
      }
    }
    return (
      result ?? {
        status: ctx.cancelled ? 'cancelled' : 'failed',
        error: ctx.cancelled ? undefined : 'Claude ended without a result',
      }
    );
  } catch (error) {
    if (ctx.cancelled) return { status: 'cancelled' };
    throw error;
  } finally {
    releaseInput?.();
    q.close();
  }
}
