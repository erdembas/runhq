import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { releaseLayout, verifyRelease } from './verify-release.mjs';
import { onRequest } from '../functions/api/updates/latest.js';

const { Request, Response } = globalThis;

function updaterRequest(method = 'GET') {
  return { request: new Request('https://runhq.dev/api/updates/latest', { method }) };
}

function publishedRelease(overrides = {}) {
  return {
    tag_name: 'v2.0.0',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'latest.json',
        browser_download_url:
          'https://github.com/erdembas/runhq/releases/download/v2.0.0/latest.json',
      },
    ],
    ...overrides,
  };
}

test('Pages root updater entrypoint forwards the exact published manifest and cache headers', async (t) => {
  const manifest = JSON.stringify({ version: '2.0.0', platforms: { 'darwin-aarch64': {} } });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json(publishedRelease()) : new Response(manifest);
  });
  const response = await onRequest(updaterRequest());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), manifest);
  assert.equal(response.headers.get('x-runhq-proxy'), 'cf-pages');
  assert.equal(response.headers.get('x-runhq-release-tag'), 'v2.0.0');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(
    response.headers.get('cache-control'),
    'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
  );
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      'https://api.github.com/repos/erdembas/runhq/releases/latest',
      'https://github.com/erdembas/runhq/releases/download/v2.0.0/latest.json',
    ],
  );
  assert.equal(calls[1].options.redirect, 'follow');
});

for (const flags of [{ draft: true }, { prerelease: true }]) {
  test(`Pages updater excludes ${Object.keys(flags)[0]} releases without fetching artifacts`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () =>
      Response.json(publishedRelease(flags)),
    );
    const response = await onRequest(updaterRequest());
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('x-runhq-reason'), 'latest_is_not_stable');
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test('Pages updater treats no published release as no update', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  const response = await onRequest(updaterRequest());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('x-runhq-reason'), 'no_published_release');
});

test('Pages updater rejects methods other than GET and HEAD without fetching', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('Method rejection must not fetch GitHub');
  });
  const response = await onRequest(updaterRequest('POST'));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(fetch.mock.callCount(), 0);
});

for (const [name, releaseStatus, release, manifest, expectedError] of [
  ['GitHub failure', 503, {}, null, 'github_api_unavailable'],
  ['missing manifest', 200, publishedRelease({ assets: [] }), null, 'manifest_asset_missing'],
  ['unavailable manifest', 200, publishedRelease(), { status: 404 }, 'manifest_unavailable'],
  ['invalid manifest', 200, publishedRelease(), { body: 'invalid-json' }, 'manifest_invalid_json'],
]) {
  test(`Pages updater returns an uncached error for ${name}`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls === 1) return Response.json(release, { status: releaseStatus });
      return new Response(manifest.body ?? '', { status: manifest.status ?? 200 });
    });
    const response = await onRequest(updaterRequest());
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error, expectedError);
  });
}

const script = fileURLToPath(new URL('./publish-release-aliases.sh', import.meta.url));
const tag = 'v2.0.0';
const repository = 'erdembas/runhq';
const platforms = [
  ['macos', 'aarch64', 'aarch64-apple-darwin', [['dmg', 'RunHQ_2.0.0_aarch64.dmg']]],
  ['macos', 'x64', 'x86_64-apple-darwin', [['dmg', 'RunHQ_2.0.0_x64.dmg']]],
  [
    'linux',
    'amd64',
    'x86_64-unknown-linux-gnu',
    [
      ['deb', 'RunHQ_2.0.0_amd64.deb'],
      ['rpm', 'RunHQ-2.0.0-1.x86_64.rpm'],
      ['appimage', 'RunHQ_2.0.0_amd64.AppImage'],
    ],
  ],
  [
    'linux',
    'arm64',
    'aarch64-unknown-linux-gnu',
    [
      ['deb', 'RunHQ_2.0.0_arm64.deb'],
      ['rpm', 'RunHQ-2.0.0-1.aarch64.rpm'],
      ['appimage', 'RunHQ_2.0.0_aarch64.AppImage'],
    ],
  ],
  [
    'windows',
    'x64',
    'x86_64-pc-windows-msvc',
    [
      ['nsis', 'RunHQ_2.0.0_x64-setup.exe'],
      ['msi', 'RunHQ_2.0.0_x64_en-US.msi'],
    ],
  ],
  [
    'windows',
    'arm64',
    'aarch64-pc-windows-msvc',
    [
      ['nsis', 'RunHQ_2.0.0_arm64-setup.exe'],
      ['msi', 'RunHQ_2.0.0_arm64_en-US.msi'],
    ],
  ],
];

function aliasFixture(t, platform, bundleRoot, files = platform[3]) {
  const root = mkdtempSync(join(tmpdir(), 'runhq release aliases '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  writeFileSync(
    join(root, 'bin', 'gh'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$ALIAS_UPLOAD_ARGS"\n',
    { mode: 0o755 },
  );
  for (const [format, name] of files) {
    const path = join(root, bundleRoot, format, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `fixture for ${name}`);
  }
  const result = spawnSync('bash', [script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      FAMILY: platform[0],
      ARCH: platform[1],
      TARGET: platform[2],
      RELEASE_TAG: tag,
      GH_REPO: repository,
      ALIAS_UPLOAD_ARGS: join(root, 'uploads.txt'),
    },
  });
  return { root, result };
}

for (const platform of platforms) {
  test(`aliases every ${platform[0]}/${platform[1]} package from workspace target output`, (t) => {
    const { root, result } = aliasFixture(t, platform, `target/${platform[2]}/release/bundle`);
    assert.equal(result.status, 0, result.stderr);
    const args = readFileSync(join(root, 'uploads.txt'), 'utf8').trim().split('\n');
    assert.deepEqual(args.slice(0, 3), ['release', 'upload', tag]);
    const aliases = releaseLayout('2.0.0').aliases;
    for (const [, name] of platform[3]) {
      const alias = [...aliases].find(([, original]) => original === name)[0];
      assert.ok(args.includes(alias));
      assert.equal(readFileSync(join(root, alias), 'utf8'), `fixture for ${name}`);
    }
  });
}

for (const location of [
  'target/release/bundle',
  'apps/desktop/src-tauri/target/release/bundle',
  'apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle',
]) {
  test(`discovers aliases in ${location}`, (t) => {
    const { result } = aliasFixture(t, platforms[0], location);
    assert.equal(result.status, 0, result.stderr);
  });
}

test('missing required MSI fails without uploading a partial Windows release', (t) => {
  const { root, result } = aliasFixture(
    t,
    platforms[5],
    'target/release/bundle',
    platforms[5][3].slice(0, 1),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required windows\/arm64 bundle: msi/);
  assert.throws(() => readFileSync(join(root, 'uploads.txt')), /ENOENT/);
});

test('an old cached bundle cannot become the new stable alias', (t) => {
  const { result } = aliasFixture(t, platforms[0], 'target/release/bundle', [
    ['dmg', 'RunHQ_1.1.0_aarch64.dmg'],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RunHQ_2\.0\.0_aarch64\.dmg/);
});

function releaseFixture() {
  const { aliases, platforms: targets, signed } = releaseLayout('2.0.0');
  const names = new Set([
    'latest.json',
    ...aliases.keys(),
    ...aliases.values(),
    ...signed,
    ...[...signed].map((name) => `${name}.sig`),
  ]);
  return {
    tag,
    repository,
    release: {
      tagName: tag,
      isDraft: false,
      isPrerelease: false,
      assets: [...names].map((name) => ({ name, size: 42 })),
    },
    manifest: {
      version: '2.0.0',
      platforms: Object.fromEntries(
        [...targets].map(([platform, asset]) => [
          platform,
          {
            url: `https://github.com/${repository}/releases/download/${tag}/${Array.isArray(asset) ? asset[0] : asset}`,
            signature: 'non-empty fixture signature',
          },
        ]),
      ),
    },
  };
}

test('accepts a complete release with all six architectures and bundle formats', () => {
  assert.deepEqual(verifyRelease(releaseFixture()), { assets: 39, platforms: 18 });
});

test('accepts six unsuffixed updater targets without optional format targets or signatures', () => {
  const fixture = releaseFixture();
  const referenced = new Set();
  for (const [key, entry] of Object.entries(fixture.manifest.platforms)) {
    if (/-(app|appimage|deb|rpm|msi|nsis)$/.test(key)) {
      delete fixture.manifest.platforms[key];
    } else {
      referenced.add(entry.url.split('/').at(-1));
    }
  }
  fixture.release.assets = fixture.release.assets.filter(
    (asset) => !asset.name.endsWith('.sig') || referenced.has(asset.name.slice(0, -4)),
  );
  assert.deepEqual(verifyRelease(fixture), { assets: 33, platforms: 6 });
});

for (const [name, alter, error] of [
  [
    'missing stable alias',
    (f) => {
      f.release.assets = f.release.assets.filter((a) => a.name !== 'runhq_arm64.msi');
    },
    /Missing or empty release asset: runhq_arm64.msi/,
  ],
  [
    'partial matrix manifest',
    (f) => {
      delete f.manifest.platforms['linux-aarch64'];
    },
    /incorrect updater URL: linux-aarch64/,
  ],
  [
    'missing detached signature',
    (f) => {
      f.release.assets = f.release.assets.filter((a) => a.name !== 'RunHQ_x64.app.tar.gz.sig');
    },
    /RunHQ_x64.app.tar.gz.sig/,
  ],
  [
    'wrong updater version',
    (f) => {
      f.manifest.version = '1.1.0';
    },
    /Updater version must be 2.0.0/,
  ],
  [
    'wrong architecture URL',
    (f) => {
      f.manifest.platforms['darwin-x86_64'].url = f.manifest.platforms['darwin-aarch64'].url;
    },
    /incorrect updater URL: darwin-x86_64/,
  ],
  [
    'incorrect optional variant',
    (f) => {
      f.manifest.platforms['linux-aarch64-deb'].url = f.manifest.platforms['linux-x86_64-deb'].url;
    },
    /incorrect updater URL: linux-aarch64-deb/,
  ],
  [
    'missing updater signature',
    (f) => {
      f.manifest.platforms['windows-x86_64'].signature = '';
    },
    /Missing updater signature/,
  ],
  [
    'draft release',
    (f) => {
      f.release.isDraft = true;
    },
    /must be published/,
  ],
  [
    'prerelease',
    (f) => {
      f.release.isPrerelease = true;
    },
    /must not be a prerelease/,
  ],
  [
    'empty package',
    (f) => {
      f.release.assets.find((a) => a.name === 'RunHQ_2.0.0_x64.dmg').size = 0;
    },
    /Missing or empty release asset/,
  ],
  [
    'wrong alias content size',
    (f) => {
      f.release.assets.find((a) => a.name === 'runhq_x64.dmg').size = 100;
    },
    /differs in size/,
  ],
]) {
  test(`rejects ${name}`, () => {
    const fixture = releaseFixture();
    alter(fixture);
    assert.throws(() => verifyRelease(fixture), error);
  });
}
