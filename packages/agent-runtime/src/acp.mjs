import { randomUUID } from 'node:crypto';
import { Rpc, pretty } from './protocol.mjs';
import { cursorExtension, requireCursorAcp } from './cursor.mjs';
import { validateAttachments } from './attachments.mjs';
import { acpApproval } from './permissions.mjs';

class AcpRpc extends Rpc {
  send(message) {
    super.send({ jsonrpc: '2.0', ...message });
  }
}
const values = (option) =>
  (option?.options ?? []).flatMap((value) => (value.options ? value.options : [value]));
const category = (session, name) =>
  (session.configOptions ?? []).find(
    (option) => option.type === 'select' && option.category === name,
  );
export function acpCatalog(session, capabilities = {}) {
  const model = category(session, 'model');
  const thought = category(session, 'thought_level');
  const mode = category(session, 'mode');
  const models = model
    ? values(model).map((m) => ({
        id: m.value,
        name: m.name,
        description: m.description,
        efforts: m.value === model.currentValue ? values(thought).map((v) => v.value) : [],
      }))
    : (session.models?.availableModels ?? []).map((m) => ({
        id: m.modelId,
        name: m.name,
        description: m.description,
        efforts: [],
      }));
  const modes = mode
    ? values(mode).map((v) => v.value)
    : (session.modes?.availableModes ?? []).map((m) => m.id);
  return {
    models,
    agents: modes,
    commands: [],
    modes: ['default', ...(modes.includes('plan') ? ['plan'] : [])],
    can_steer: false,
    can_resume: !!(capabilities.loadSession || capabilities.sessionCapabilities?.resume),
    connection: 'acp',
  };
}

export async function runAcp(ctx, catalog = false) {
  const cfg = ctx.config;
  if (!catalog) validateAttachments(cfg.attachments, 'acp');
  if (cfg.backend === 'cursor') await requireCursorAcp(ctx);
  if (ctx.cancelled) return { status: 'cancelled' };
  const child = ctx.child(cfg.executable, cfg.args ?? []);
  const prefix = randomUUID();
  let sessionId,
    session = {},
    replaying = false;
  const permissions = new Map();
  const rpc = new AcpRpc(child, async (message) => {
    const p = message.params ?? {};
    if (
      await cursorExtension(ctx, rpc, message, {
        prefix,
        pending: permissions,
        suppressed: () => catalog || replaying || ctx.cancelled,
        todos: () => session.cursorTodos ?? [],
        setTodos: (todos) => {
          session.cursorTodos = todos;
          persist();
        },
      })
    )
      return;
    if (message.id != null) {
      if (message.method !== 'session/request_permission') {
        rpc.send({
          id: message.id,
          error: { code: -32601, message: `RunHQ does not advertise ${message.method}` },
        });
        if (!catalog)
          ctx.item(
            `${prefix}-unsupported-${message.id}`,
            'notice',
            'Unsupported agent request',
            message.method,
            'failed',
          );
        return;
      }
      if (catalog || replaying || ctx.cancelled) {
        rpc.send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } });
        return;
      }
      const options = p.options ?? [];
      const id = `acp-${message.id}`;
      permissions.set(id, message.id);
      await ctx.ask(
        {
          id,
          kind: 'approval',
          title: p.toolCall?.title || 'Agent requests permission',
          details: pretty(p.toolCall),
          choices: options.map((o) => ({ label: o.name, value: o.optionId })),
        },
        async (value) => {
          if (ctx.cancelled) throw new Error('Turn was cancelled');
          if (!options.some((o) => o.optionId === value.decision))
            throw new Error('Choose a permission option offered by this agent');
          rpc.send({
            id: message.id,
            result: { outcome: { outcome: 'selected', optionId: value.decision } },
          });
          permissions.delete(id);
        },
        acpApproval(p),
      );
      return;
    }
    if (message.method !== 'session/update') return;
    const u = p.update ?? {};
    if (u.sessionUpdate === 'config_option_update') {
      session.configOptions = u.configOptions;
      if (!catalog && !replaying) persist();
    }
    if (catalog || replaying) return;
    if (['agent_message_chunk', 'agent_thought_chunk'].includes(u.sessionUpdate)) {
      const kind = u.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'assistant';
      const id = `${prefix}-${u.messageId || kind}`;
      if (u.content?.type === 'text') ctx.delta(id, kind, u.content.text, 'Agent');
      else ctx.item(`${id}-content`, 'notice', 'Agent content', pretty(u.content));
    } else if (['tool_call', 'tool_call_update'].includes(u.sessionUpdate)) {
      const id = `${prefix}-${u.toolCallId}`;
      const prior = ctx.items.get(id);
      ctx.item(
        id,
        'tool',
        u.title || prior?.title || 'Tool',
        u.content ? pretty(u.content) : u.rawInput ? pretty(u.rawInput) : prior?.text || '',
        ['completed', 'failed'].includes(u.status) ? u.status : 'running',
      );
    } else if (u.sessionUpdate === 'plan')
      ctx.item(`${prefix}-plan`, 'plan', 'Plan', pretty(u.entries));
    else if (u.sessionUpdate === 'current_mode_update') {
      session.modes = { ...session.modes, currentModeId: u.modeId };
      const mode = category(session, 'mode');
      if (mode) mode.currentValue = u.modeId;
      persist();
      ctx.item(`${prefix}-mode`, 'notice', 'Agent mode', u.modeId);
    } else if (u.sessionUpdate === 'usage_update') ctx.emit({ type: 'usage', usage: u });
  });
  ctx.interrupt = async () => {
    ctx.cancelled = true;
    for (const [id, requestId] of permissions) {
      rpc.send({ id: requestId, result: { outcome: { outcome: 'cancelled' } } });
      ctx.resolve(id);
    }
    permissions.clear();
    if (sessionId) rpc.send({ method: 'session/cancel', params: { sessionId } });
    else child.kill();
  };
  const initialized = await rpc.call('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'runhq', version: '1.1.0' },
  });
  if (initialized.protocolVersion !== 1)
    throw new Error('This agent uses an unsupported ACP protocol version');
  const capabilities = initialized.agentCapabilities ?? {};
  if (initialized.authMethods?.some((method) => method.id === 'cursor_login')) {
    try {
      await rpc.call('authenticate', { methodId: 'cursor_login' });
    } catch {
      throw new Error(
        'Cursor authentication failed. Run agent login in your terminal, then retry.',
      );
    }
  }
  const params = { cwd: cfg.cwd, mcpServers: [] };
  if (cfg.native_id && !catalog) {
    sessionId = cfg.native_id;
    replaying = true;
    if (capabilities.sessionCapabilities?.resume)
      session = await rpc.call('session/resume', { ...params, sessionId });
    else if (capabilities.loadSession)
      session = await rpc.call('session/load', { ...params, sessionId });
    else
      throw new Error(
        'This ACP agent cannot resume sessions. Start a new task or use its terminal interface.',
      );
    replaying = false;
  } else {
    session = await rpc.call('session/new', params);
    sessionId = session.sessionId;
    if (!sessionId) throw new Error('The ACP agent did not return a session ID');
    if (!catalog) ctx.emit({ type: 'native', id: sessionId });
  }
  session = { ...(cfg.native_id ? (cfg.runtime_state ?? {}) : {}), ...(session ?? {}) };
  if (!cfg.native_id) {
    const initialMode = category(session, 'mode')?.currentValue || session.modes?.currentModeId;
    if (initialMode && initialMode !== 'plan') session.defaultMode = initialMode;
  }
  function persist() {
    ctx.emit({
      type: 'state',
      state: {
        configOptions: session.configOptions,
        models: session.models,
        modes: session.modes,
        defaultMode: session.defaultMode,
        cursorTodos: session.cursorTodos,
      },
    });
  }
  if (!catalog) persist();
  if (ctx.cancelled) return { status: 'cancelled' };
  async function set(categoryName, value) {
    if (!value) return;
    const option = category(session, categoryName);
    if (!option || !values(option).some((v) => v.value === value))
      throw new Error(`This agent does not offer ${categoryName}: ${value}`);
    const result = await rpc.call('session/set_config_option', {
      sessionId,
      configId: option.id,
      value,
    });
    if (result.configOptions) session.configOptions = result.configOptions;
    if (!catalog) persist();
  }
  if (cfg.model) {
    if (category(session, 'model')) await set('model', cfg.model);
    else if (session.models?.availableModels?.some((m) => m.modelId === cfg.model)) {
      await rpc.call('session/set_model', { sessionId, modelId: cfg.model });
      session.models.currentModelId = cfg.model;
      if (!catalog) persist();
    } else throw new Error('The selected model is not advertised by this ACP agent');
  }
  if (catalog) return acpCatalog(session, capabilities);
  await set('thought_level', cfg.effort);
  let requestedMode = cfg.agent || (cfg.mode === 'plan' ? 'plan' : '');
  if (!requestedMode && cfg.mode === 'default') {
    const current = category(session, 'mode')?.currentValue || session.modes?.currentModeId;
    const available = acpCatalog(session).agents;
    // Restore an observed default; Cursor additionally defines its agent mode explicitly.
    if (current === 'plan' || current === 'ask') {
      const fallback =
        cfg.backend === 'cursor' && available.includes('agent') ? 'agent' : session.defaultMode;
      if (fallback && available.includes(fallback)) requestedMode = fallback;
    }
  }
  if (requestedMode) {
    if (category(session, 'mode')) await set('mode', requestedMode);
    else if (session.modes?.availableModes?.some((m) => m.id === requestedMode)) {
      await rpc.call('session/set_mode', { sessionId, modeId: requestedMode });
      session.modes.currentModeId = requestedMode;
      persist();
    } else throw new Error('The selected mode is not advertised by this ACP agent');
  } else if (cfg.native_id && cfg.mode === 'default') {
    // Never guess that a provider-specific mode means safe implementation mode.
    const current = category(session, 'mode')?.currentValue || session.modes?.currentModeId;
    if (current === 'plan')
      throw new Error(
        'Choose an agent mode from the profile menu to leave this ACP agent’s saved plan mode.',
      );
  }
  ctx.emit({ type: 'status', status: 'running' });
  const result = await rpc.call(
    'session/prompt',
    { sessionId, prompt: [{ type: 'text', text: cfg.prompt }] },
    0,
  );
  return { status: ctx.cancelled || result.stopReason === 'cancelled' ? 'cancelled' : 'completed' };
}
