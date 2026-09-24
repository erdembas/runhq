import { spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(root, 'workbench.local');
const profile = resolve(local, 'profile');
const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
const bundle = resolve(target, 'release/bundle/macos/RunHQ Workbench.app');
const pnpm = process.env.npm_execpath;
const mode = process.argv[2] || 'build';

function run(command, args) {
  return new Promise((accept, reject) => {
    const env = { ...process.env, RUNHQ_HOME: profile };
    delete env.TAURI_CONFIG;
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? accept() : reject(new Error(`${command} exited with ${signal ?? code}`)),
    );
  });
}

try {
  if (process.platform !== 'darwin')
    throw new Error('This separate local app launcher currently supports macOS.');
  if (!pnpm) throw new Error('Use pnpm workbench or pnpm workbench:open.');
  if (!['build', 'open', 'build-only'].includes(mode))
    throw new Error('Unknown Workbench launcher mode.');
  mkdirSync(local, { recursive: true });
  await run('python3', [
    resolve(root, 'scripts/prepare-workbench-profile.py'),
    resolve(homedir(), '.runhq'),
    profile,
  ]);
  if (mode !== 'open') {
    const escapeXml = (value) =>
      value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const plist = resolve(local, 'Info.plist');
    // Finder launches and app relaunches must use the same independent profile.
    writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>LSEnvironment</key><dict><key>RUNHQ_HOME</key><string>${escapeXml(profile)}</string></dict></dict></plist>`,
    );
    const config = {
      productName: 'RunHQ Workbench',
      identifier: 'io.github.erdembas.runhq.workbench',
      bundle: { createUpdaterArtifacts: false, macOS: { infoPlist: plist } },
      plugins: { updater: { endpoints: [] } },
    };
    await run(process.execPath, [
      pnpm,
      '--filter',
      '@runhq/desktop',
      'exec',
      'tauri',
      'build',
      '--bundles',
      'app',
      '--config',
      JSON.stringify(config),
    ]);
  }
  if (!existsSync(bundle)) throw new Error('Build the Workbench app with pnpm workbench first.');
  if (mode !== 'build-only') await run('open', ['--env', `RUNHQ_HOME=${profile}`, bundle]);
  console.log(`Local app: ${bundle}`);
  console.log(`Independent profile: ${profile}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
