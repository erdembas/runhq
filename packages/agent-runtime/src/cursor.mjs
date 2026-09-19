import { pretty, requireAnswers } from './protocol.mjs';
import { clearTimeout, setTimeout } from 'node:timers';

export async function requireCursorAcp(ctx) {
  // Older Cursor versions treat the unknown positional "acp" as a chat prompt.
  // --help exits before any model turn and distinguishes those builds safely.
  const child = ctx.child(ctx.config.executable, [...(ctx.config.args ?? []), '--help']);
  const supported = await new Promise((resolve) => {
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(0, 32768);
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(
        code === 0 &&
          output
            .split('\n')
            .some(
              (line) => /^\s*acp(?:\s|$)/.test(line) || /^\s*Usage:.*\sacp(?:\s|$)/i.test(line),
            ),
      );
    });
    child.stdin.end();
  });
  if (!supported)
    throw new Error(
      'This Cursor CLI does not advertise ACP support. Run agent update, then agent login and retry.',
    );
}

// Cursor's ACP extensions use their own outcomes, independently of tool permissions.
// Keep the wire IDs intact: labels can be translated or duplicated by the provider.
export async function cursorExtension(ctx, rpc, message, state) {
  const { method, id, params: p = {} } = message;
  if (
    ![
      'cursor/ask_question',
      'cursor/create_plan',
      'cursor/update_todos',
      'cursor/task',
      'cursor/generate_image',
    ].includes(method)
  )
    return false;
  if (state.suppressed()) {
    if (id != null) rpc.send({ id, result: { outcome: { outcome: 'cancelled' } } });
    return true;
  }
  const itemId = `${state.prefix}-${p.toolCallId || method}`;
  const ask = async (request, answer) => {
    if (id == null) return;
    const requestId = `acp-cursor-${id}`;
    state.pending.set(requestId, id);
    await ctx.ask({ ...request, id: requestId }, async (value) => {
      if (ctx.cancelled) throw new Error('Turn was cancelled');
      const outcome = answer(value);
      rpc.send({ id, result: { outcome } });
      state.pending.delete(requestId);
    });
  };
  if (method === 'cursor/ask_question') {
    const questions = (p.questions ?? []).map((q) => ({
      id: q.id,
      question: q.prompt,
      options: (q.options ?? []).map((option) => ({ label: option.label, value: option.id })),
      multiple: !!q.allowMultiple,
      secret: false,
      allow_custom: false,
    }));
    await ask(
      { kind: 'question', title: p.title || 'Cursor needs your input', questions, details: '' },
      (value) => {
        const answers = requireAnswers(questions, value);
        return {
          outcome: 'answered',
          answers: questions.map((question) => {
            const selectedOptionIds = answers[question.id];
            if (
              (!question.multiple && selectedOptionIds.length !== 1) ||
              new Set(selectedOptionIds).size !== selectedOptionIds.length ||
              selectedOptionIds.some(
                (optionId) => !question.options.some((option) => option.value === optionId),
              )
            )
              throw new Error(`Choose an offered option for: ${question.question}`);
            return { questionId: question.id, selectedOptionIds };
          }),
        };
      },
    );
  } else if (method === 'cursor/create_plan') {
    ctx.item(
      itemId,
      'plan',
      p.name || 'Cursor plan',
      pretty({
        plan: p.plan,
        overview: p.overview,
        entries: p.todos ?? [],
        phases: p.phases,
      }),
    );
    state.setTodos(p.todos ?? []);
    await ask(
      {
        kind: 'approval',
        title: p.name ? `Approve plan: ${p.name}` : 'Approve Cursor plan',
        details: [p.overview, p.plan].filter(Boolean).join('\n\n'),
        choices: [
          { label: 'Approve plan', value: 'accepted' },
          { label: 'Reject plan', value: 'rejected' },
        ],
      },
      (value) => {
        if (!['accepted', 'rejected'].includes(value?.decision))
          throw new Error('Choose whether to approve or reject this plan');
        return { outcome: value.decision };
      },
    );
  } else if (method === 'cursor/update_todos') {
    const previous = p.merge ? state.todos() : [];
    const todos = new Map(previous.map((todo) => [todo.id, todo]));
    for (const todo of p.todos ?? []) todos.set(todo.id, todo);
    state.setTodos([...todos.values()]);
    ctx.item(`${state.prefix}-cursor-todos`, 'plan', 'Cursor tasks', pretty([...todos.values()]));
  } else if (method === 'cursor/task') {
    // A distinct kind so the transcript can show the provider's own fan-out as structure. The
    // subagent runs inside the provider: RunHQ reports it, it does not schedule or route it.
    ctx.item(
      itemId,
      'subagent',
      p.description || 'Cursor subagent',
      pretty({
        prompt: p.prompt,
        agentId: p.agentId,
        subagentType: p.subagentType,
        model: p.model,
        durationMs: p.durationMs,
      }),
    );
  } else if (method === 'cursor/generate_image') {
    ctx.item(
      itemId,
      'notice',
      p.description || 'Cursor generated image',
      pretty({
        filePath: p.filePath,
        referenceImagePaths: p.referenceImagePaths,
      }),
    );
  }
  return true;
}
