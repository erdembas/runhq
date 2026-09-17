import { createInterface } from 'node:readline';
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
let turn;
createInterface({ input: process.stdin }).on('line', (line) => {
  const value = JSON.parse(line);
  const reply = (result) => emit({ id: value.id, result });
  if (value.method === 'initialize') reply({});
  if (value.method === 'thread/resume') {
    if (value.params.threadId !== 'saved-thread' || !value.params.excludeTurns)
      throw new Error('Incorrect resume');
    reply({ thread: { id: 'saved-thread' }, model: 'test-model' });
  }
  if (value.method === 'turn/start') {
    if (value.params.collaborationMode.settings.model !== 'test-model')
      throw new Error('Missing plan model');
    turn = { id: 'turn-1', status: 'inProgress' };
    reply({ turn });
    emit({ method: 'turn/started', params: { turn } });
    emit({
      id: 900,
      method: 'item/tool/requestUserInput',
      params: {
        questions: [{ id: 'color', question: 'Which color?', options: [{ label: 'Blue' }] }],
      },
    });
  }
  if (value.id === 900 && value.result) {
    if (value.result.answers.color.answers[0] !== 'Blue') throw new Error('Wrong answer shape');
    emit({ method: 'item/agentMessage/delta', params: { itemId: 'answer', delta: 'Blue' } });
    emit({
      method: 'item/completed',
      params: { item: { id: 'answer', type: 'agentMessage', text: 'Blue' } },
    });
    emit({ method: 'turn/completed', params: { turn: { ...turn, status: 'completed' } } });
  }
  if (value.method === 'turn/interrupt') {
    reply({});
    emit({ method: 'turn/completed', params: { turn: { ...turn, status: 'interrupted' } } });
  }
  if (value.method === 'turn/steer') {
    if (value.params.expectedTurnId !== turn.id) throw new Error('Missing turn guard');
    reply({ turnId: turn.id });
  }
});
