import { Context, jsonLines } from './protocol.mjs';
import { runCodex } from './codex.mjs';
import { runOpenCode } from './opencode.mjs';
import { runClaude } from './claude.mjs';
import { runAcp } from './acp.mjs';

let context;
let started = false;
const commands = new Set();
async function drainCommands() {
  // A provider may publish turn completion before its HTTP answer response arrives.
  // Keep the bridge alive long enough to acknowledge answers already in flight.
  let timer;
  try {
    await Promise.race([
      Promise.allSettled([...commands]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
if (Number(process.versions.node.split('.')[0]) < 22) {
  process.stdout.write(
    JSON.stringify({
      type: 'finished',
      status: 'failed',
      error: 'Node.js 22 or newer is required',
    }) + '\n',
  );
  process.exit(1);
}
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\n');
async function run(config) {
  context = new Context(config, emit);
  try {
    const adapter = { codex: runCodex, opencode: runOpenCode, claude: runClaude, acp: runAcp }[
      config.adapter || config.backend
    ];
    if (!adapter) throw new Error('Unsupported agent backend');
    const result = await adapter(context, config.operation === 'catalog');
    await drainCommands();
    context.flush();
    emit(
      config.operation === 'catalog'
        ? { type: 'catalog', catalog: result }
        : { type: 'finished', ...result },
    );
  } catch (error) {
    await drainCommands();
    emit({
      type: 'finished',
      status: context.cancelled ? 'cancelled' : 'failed',
      error: context.cancelled ? undefined : error.message,
    });
  } finally {
    context.close();
    // Drain protocol output before exiting. The Rust owner terminates the process group.
    process.stdout.write('', () => process.exit(0));
  }
}
function ownerDisconnected() {
  context?.close();
  // The Rust owner creates a dedicated Unix group. EOF also covers abrupt app exit.
  if (process.platform !== 'win32' && process.env.RUNHQ_AGENT_PROCESS_GROUP === '1') {
    try {
      process.kill(-process.pid, 'SIGKILL');
    } catch {
      /* owner may already have terminated the group */
    }
  }
  process.exit(0);
}
process.on('SIGTERM', ownerDisconnected);
process.on('SIGINT', ownerDisconnected);
async function main() {
  try {
    for await (const command of jsonLines(process.stdin)) {
      if (command.type === 'start' && !started) {
        started = true;
        void run(command.config);
        continue;
      }
      if (!context) continue;
      // Do not block stdin on an operation: answers and interrupt must remain deliverable.
      const task = (async () => {
        try {
          if (command.type === 'answer') await context.answer(command.id, command.value);
          else if (command.type === 'interrupt') {
            context.cancelled = true;
            await context.interrupt?.();
          } else if (command.type === 'steer') {
            if (!context.steer)
              throw new Error('This backend does not support steering an active turn');
            await context.steer(command.text);
          }
          emit({ type: 'ack', command_id: command.command_id });
        } catch (error) {
          emit({ type: 'command_error', command_id: command.command_id, message: error.message });
        }
      })();
      commands.add(task);
      void task.finally(() => commands.delete(task));
    }
    ownerDisconnected();
  } catch (error) {
    emit({ type: 'finished', status: 'failed', error: error.message });
    context?.close();
    process.exit(1);
  }
}
void main();
