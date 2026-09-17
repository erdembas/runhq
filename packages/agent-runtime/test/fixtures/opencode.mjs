#!/usr/bin/env node
import { createServer } from 'node:http';
let events;
const emit = (type, properties) =>
  events.write(`data: ${JSON.stringify({ type, properties })}\r\n\r\n`);
const server = createServer(async (request, response) => {
  if (
    request.headers.authorization !==
    `Basic ${Buffer.from(`runhq:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`
  ) {
    response.writeHead(401).end();
    return;
  }
  const path = new URL(request.url, 'http://localhost').pathname;
  let text = '';
  for await (const chunk of request) text += chunk;
  const body = text ? JSON.parse(text) : {};
  const json = (value) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(value));
  };
  if (path === '/global/health') return json({ healthy: true });
  if (path === '/session/saved-thread') return json({ id: 'saved-thread' });
  if (path === '/event') {
    events = response;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(': connected\r\n\r\n');
    return;
  }
  if (path.endsWith('/prompt_async')) {
    response.writeHead(204).end();
    emit('session.status', { sessionID: 'saved-thread', status: { type: 'busy' } });
    emit('message.updated', { info: { id: 'user', sessionID: 'saved-thread', role: 'user' } });
    emit('message.part.updated', {
      part: {
        id: 'echo',
        messageID: 'user',
        sessionID: 'saved-thread',
        type: 'text',
        text: body.parts[0].text,
      },
    });
    emit('permission.asked', { sessionID: 'other-session', id: 'ignore', permission: 'external' });
    emit('permission.asked', { sessionID: 'saved-thread', id: 'p1', permission: 'edit' });
    return;
  }
  if (path === '/permission/p1/reply') {
    if (body.reply !== 'reject') {
      response.writeHead(400).end();
      return;
    }
    json(true);
    emit('permission.replied', { sessionID: 'saved-thread', requestID: 'p1' });
    emit('question.asked', {
      sessionID: 'saved-thread',
      id: 'q1',
      questions: [
        { question: 'Choose', multiple: true, options: [{ label: 'A' }, { label: 'B' }] },
      ],
    });
    return;
  }
  if (path === '/question/q1/reply') {
    if (JSON.stringify(body.answers) !== '[["A","B"]]') {
      response.writeHead(400).end();
      return;
    }
    setTimeout(() => json(true), 100);
    emit('message.part.updated', {
      part: {
        id: 'final',
        sessionID: 'saved-thread',
        type: 'text',
        text: 'Received both answers',
        time: { end: 1 },
      },
    });
    emit('session.status', { sessionID: 'saved-thread', status: { type: 'idle' } });
    return;
  }
  response.writeHead(404).end();
});
server.listen(Number(process.argv.at(-1)), '127.0.0.1');
