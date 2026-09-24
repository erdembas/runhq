import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const targets = [
  {
    platform: 'macos-latest',
    family: 'macos',
    arch: 'aarch64',
    target: 'aarch64-apple-darwin',
    args: '--target aarch64-apple-darwin',
  },
  {
    platform: 'macos-latest',
    family: 'macos',
    arch: 'x64',
    target: 'x86_64-apple-darwin',
    args: '--target x86_64-apple-darwin',
  },
  {
    platform: 'ubuntu-22.04',
    family: 'linux',
    arch: 'amd64',
    target: 'x86_64-unknown-linux-gnu',
    args: '',
  },
  {
    platform: 'ubuntu-22.04-arm',
    family: 'linux',
    arch: 'arm64',
    target: 'aarch64-unknown-linux-gnu',
    args: '',
  },
  {
    platform: 'windows-latest',
    family: 'windows',
    arch: 'x64',
    target: 'x86_64-pc-windows-msvc',
    args: '',
  },
  // Cross-compile ARM64 on the x64 runner with the MSVC ARM64 toolchain.
  {
    platform: 'windows-latest',
    family: 'windows',
    arch: 'arm64',
    target: 'aarch64-pc-windows-msvc',
    args: '--target aarch64-pc-windows-msvc',
  },
];

export function releasePlan(tag, family = 'all') {
  if (typeof tag !== 'string' || tag !== tag.trim() || !/^v\d+\.\d+\.\d+$/.test(tag))
    throw new Error('Expected a stable vX.Y.Z release tag');
  if (!['all', 'macos', 'linux', 'windows'].includes(family))
    throw new Error(`Unknown release family: ${family}`);
  return {
    tag,
    matrix: { include: targets.filter((target) => family === 'all' || target.family === family) },
  };
}

export function checkReleaseVersions(root, tag) {
  const version = releasePlan(tag).tag.slice(1);
  for (const path of [
    'package.json',
    'apps/desktop/package.json',
    'apps/desktop/src-tauri/tauri.conf.json',
  ]) {
    if (JSON.parse(readFileSync(resolve(root, path), 'utf8')).version !== version)
      throw new Error(`${path} does not match release ${tag}`);
  }
  for (const path of ['apps/desktop/src-tauri/Cargo.toml', 'crates/runhq-core/Cargo.toml']) {
    const source = readFileSync(resolve(root, path), 'utf8');
    if (source.match(/^version\s*=\s*"([^"]+)"\s*# x-release-please-version/m)?.[1] !== version)
      throw new Error(`${path} does not match release ${tag}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--check-version') {
    checkReleaseVersions(process.argv[3], process.env.RELEASE_TAG);
  } else {
    const plan = releasePlan(process.env.RELEASE_TAG, process.env.RELEASE_FAMILY || 'all');
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `tag=${plan.tag}\nmatrix=${JSON.stringify(plan.matrix)}\n`,
    );
  }
}
