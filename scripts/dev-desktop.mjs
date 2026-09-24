import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.env.npm_execpath;

function run(command, args, env = process.env) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) accept();
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}

try {
  if (!pnpm) throw new Error('Start this script with pnpm dev.');
  if (process.platform !== 'darwin') {
    await run(process.execPath, [pnpm, 'tauri:dev']);
  } else {
    // A bare `tauri dev` binary uses WebKit/runhq and http://localhost:1420.
    // The installed app uses its bundle identifier and tauri://localhost.
    // Both must match to share localStorage (sections, layouts, drafts, etc.).
    const config = JSON.parse(
      readFileSync(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
    );
    const env = { ...process.env, RUNHQ_HOME: resolve(homedir(), '.runhq') };
    delete env.TAURI_CONFIG;
    console.log(`Building the local desktop app with installed data: ${env.RUNHQ_HOME}`);
    console.log(
      'Quit the installed app first. For hot reload with a separate UI profile, use pnpm dev:hot.',
    );
    await run(
      process.execPath,
      [
        pnpm,
        '--filter',
        '@runhq/desktop',
        'exec',
        'tauri',
        'build',
        '--debug',
        '--bundles',
        'app',
        '--config',
        JSON.stringify({ bundle: { createUpdaterArtifacts: false } }),
      ],
      env,
    );
    const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
    const bundle = resolve(target, 'debug/bundle/macos', `${config.productName}.app`);
    await run('open', ['-n', '--env', `RUNHQ_HOME=${env.RUNHQ_HOME}`, bundle], env);
    console.log(`Opened ${bundle}`);
    console.log('Run pnpm dev again after editing to rebuild and reopen the local app.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
