import {
  Rpc,
  pretty,
  questionsFrom,
  requireAnswers,
  elicitationView,
  elicitationResponse,
} from './protocol.mjs';
import { codexImageInput } from './attachments.mjs';

export function codexRequest(method, params) {
  if (method === 'item/tool/requestUserInput') {
    const questions = questionsFrom(params.questions);
    return {
      kind: 'question',
      title: 'Codex needs your input',
      questions,
      response(value) {
        const answers = requireAnswers(questions, value);
        return {
          answers: Object.fromEntries(
            Object.entries(answers).map(([id, values]) => [id, { answers: values }]),
          ),
        };
      },
    };
  }
  if (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval'
  ) {
    const decisions = params.availableDecisions ?? [
      'accept',
      'acceptForSession',
      'decline',
      'cancel',
    ];
    return {
      kind: 'approval',
      title: method.includes('commandExecution')
        ? 'Allow this command?'
        : 'Allow these file changes?',
      choices: decisions.map((value) => ({
        label:
          typeof value === 'string'
            ? ({
                accept: 'Allow once',
                acceptForSession: 'Allow for session',
                decline: 'Deny',
                cancel: 'Cancel',
              }[value] ?? value)
            : 'Allow proposed policy change',
        value,
      })),
      response(value) {
        if (!decisions.some((d) => JSON.stringify(d) === JSON.stringify(value.decision)))
          throw new Error('Invalid approval decision');
        return { decision: value.decision };
      },
    };
  }
  if (method === 'item/permissions/requestApproval') {
    return {
      kind: 'approval',
      title: 'Grant additional permissions for this turn?',
      choices: [
        { label: 'Allow for this turn', value: 'accept' },
        { label: 'Deny', value: 'decline' },
      ],
      response(value) {
        if (!['accept', 'decline'].includes(value.decision)) throw new Error('Invalid decision');
        return {
          permissions: value.decision === 'accept' ? params.permissions : {},
          scope: 'turn',
        };
      },
    };
  }
  if (method === 'mcpServer/elicitation/request') {
    return {
      ...elicitationView(params),
      response: elicitationResponse,
    };
  }
  return null;
}

export async function runCodex(ctx, catalog = false) {
  const cfg = ctx.config;
  const input = catalog ? [] : codexImageInput(cfg.prompt, cfg.attachments);
  let finish;
  const completed = new Promise((resolve) => {
    finish = resolve;
  });
  let threadId;
  let turnId;
  const child = ctx.child(cfg.executable, ['app-server', '--listen', 'stdio://']);
  const rpc = new Rpc(child, async (message) => {
    const p = message.params ?? {};
    if (message.id != null) {
      const request = codexRequest(message.method, p);
      if (!request) {
        rpc.send({
          id: message.id,
          error: { code: -32601, message: `RunHQ does not implement ${message.method}` },
        });
        ctx.item(
          `unsupported-${message.id}`,
          'notice',
          'Unsupported provider request',
          message.method,
          'failed',
        );
        return;
      }
      const { response, ...view } = request;
      await ctx.ask({ ...view, id: String(message.id), details: pretty(p) }, async (value) => {
        rpc.send({ id: message.id, result: response(value) });
      });
      return;
    }
    switch (message.method) {
      case 'thread/started':
        threadId = p.thread.id;
        ctx.emit({ type: 'native', id: threadId });
        break;
      case 'turn/started':
        turnId = p.turn.id;
        ctx.emit({ type: 'status', status: 'running' });
        break;
      case 'serverRequest/resolved':
        ctx.resolve(p.requestId);
        break;
      case 'item/agentMessage/delta':
        ctx.delta(p.itemId, 'assistant', p.delta, 'Codex');
        break;
      case 'item/commandExecution/outputDelta':
        ctx.delta(p.itemId, 'tool', p.delta);
        break;
      case 'item/reasoning/summaryTextDelta':
        ctx.delta(p.itemId, 'reasoning', p.delta, 'Reasoning summary');
        break;
      case 'item/started':
      case 'item/completed': {
        const i = p.item;
        if (i.type === 'userMessage') break;
        const kind =
          i.type === 'agentMessage' ? 'assistant' : i.type === 'reasoning' ? 'reasoning' : 'tool';
        const text =
          i.text ??
          i.aggregatedOutput ??
          (i.type === 'reasoning' ? (i.summary ?? []).join('\n') : pretty(i));
        ctx.item(
          i.id,
          kind,
          i.command || i.name || i.type,
          text,
          message.method === 'item/started' ? 'running' : (i.status ?? 'completed'),
        );
        break;
      }
      case 'turn/plan/updated':
        ctx.item(`plan-${p.turnId}`, 'plan', 'Plan', pretty(p.plan));
        break;
      case 'turn/diff/updated':
        ctx.item('turn-diff', 'diff', 'Changes in this turn', p.diff);
        break;
      case 'thread/tokenUsage/updated':
        ctx.emit({ type: 'usage', usage: p.tokenUsage });
        break;
      case 'turn/completed':
        ctx.flush();
        finish({
          status:
            p.turn.status === 'interrupted'
              ? 'cancelled'
              : p.turn.status === 'failed'
                ? 'failed'
                : 'completed',
          error: p.turn.error?.message,
        });
        break;
      case 'error':
        ctx.item(
          'provider-error',
          'notice',
          'Provider error',
          p.error?.message ?? pretty(p),
          'failed',
        );
        break;
      case 'warning':
      case 'configWarning':
        ctx.item(`warning-${Date.now()}`, 'notice', 'Provider notice', p.message ?? p.summary);
        break;
      default:
        break;
    }
  });
  await rpc.call('initialize', {
    clientInfo: { name: 'runhq', title: 'RunHQ', version: '1.1.0' },
    capabilities: { experimentalApi: true },
  });
  rpc.send({ method: 'initialized' });
  if (catalog) {
    const models = [];
    let cursor;
    do {
      const result = await rpc.call('model/list', { limit: 100, cursor });
      models.push(
        ...result.data.map((m) => ({
          id: m.model,
          name: m.displayName,
          efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
        })),
      );
      cursor = result.nextCursor;
    } while (cursor);
    return { models, agents: [], commands: [], modes: ['default', 'plan'], can_steer: true };
  }
  const params = {
    cwd: cfg.cwd,
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: cfg.read_only_review || cfg.mode === 'plan' ? 'read-only' : 'workspace-write',
    model: cfg.model || undefined,
  };
  const started = await rpc.call(cfg.native_id ? 'thread/resume' : 'thread/start', {
    ...params,
    ...(cfg.native_id ? { threadId: cfg.native_id, excludeTurns: true } : {}),
  });
  threadId = started.thread.id;
  ctx.emit({ type: 'native', id: threadId });
  ctx.interrupt = async () => {
    ctx.cancelled = true;
    if (turnId) await rpc.call('turn/interrupt', { threadId, turnId });
  };
  ctx.steer = async (text) => {
    if (!turnId) throw new Error('The turn has not started');
    await rpc.call('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: 'text', text }],
    });
  };
  if (ctx.cancelled) return { status: 'cancelled' };
  const startedTurn = await rpc.call('turn/start', {
    threadId,
    input,
    model: cfg.model || undefined,
    effort: cfg.effort || undefined,
    collaborationMode: {
      mode: cfg.mode === 'plan' ? 'plan' : 'default',
      settings: {
        model: cfg.model || started.model,
        reasoning_effort: cfg.effort || null,
        developer_instructions: null,
      },
    },
  });
  turnId = startedTurn.turn.id;
  if (ctx.cancelled) await ctx.interrupt();
  return Promise.race([completed, rpc.done]);
}
