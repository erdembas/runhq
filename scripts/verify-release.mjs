import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function releaseLayout(version) {
  const aliases = new Map();
  const platforms = new Map();
  const signed = new Set();
  const addPlatform = (key, asset) => {
    platforms.set(key, asset);
    signed.add(asset);
  };
  for (const [arch, platform] of [
    ['aarch64', 'aarch64'],
    ['x64', 'x86_64'],
  ]) {
    aliases.set(`runhq_${arch}.dmg`, `RunHQ_${version}_${arch}.dmg`);
    const asset = `RunHQ_${arch}.app.tar.gz`;
    addPlatform(`darwin-${platform}`, asset);
    addPlatform(`darwin-${platform}-app`, asset);
  }
  for (const [arch, platform, appimage] of [
    ['amd64', 'x86_64', 'amd64'],
    ['arm64', 'aarch64', 'aarch64'],
  ]) {
    const formats = {
      appimage: `RunHQ_${version}_${appimage}.AppImage`,
      deb: `RunHQ_${version}_${arch}.deb`,
      rpm: `RunHQ-${version}-1.${platform}.rpm`,
    };
    for (const [format, asset] of Object.entries(formats)) {
      aliases.set(`runhq_${arch}.${format === 'appimage' ? 'AppImage' : format}`, asset);
      addPlatform(`linux-${platform}-${format}`, asset);
    }
    addPlatform(`linux-${platform}`, formats.appimage);
  }
  for (const [arch, platform] of [
    ['x64', 'x86_64'],
    ['arm64', 'aarch64'],
  ]) {
    const msi = `RunHQ_${version}_${arch}_en-US.msi`;
    const nsis = `RunHQ_${version}_${arch}-setup.exe`;
    aliases.set(`runhq_${arch}.msi`, msi);
    aliases.set(`runhq_${arch}-setup.exe`, nsis);
    addPlatform(`windows-${platform}-msi`, msi);
    addPlatform(`windows-${platform}-nsis`, nsis);
    // Tauri currently chooses MSI for the legacy unsuffixed target.
    // NSIS is also valid if the bundler changes its preferred updater.
    platforms.set(`windows-${platform}`, [msi, nsis]);
  }
  return { aliases, platforms, signed };
}

export function verifyRelease({ release, manifest, tag, repository }) {
  const errors = [];
  const version = tag.replace(/^v/, '');
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) errors.push(`Expected a stable vX.Y.Z tag: ${tag}`);
  if (release.tagName !== tag) errors.push(`Release tag must be ${tag}`);
  if (release.isDraft !== false) errors.push('Release must be published before updating Homebrew');
  if (release.isPrerelease !== false) errors.push('Stable release must not be a prerelease');
  if (manifest.version !== version) errors.push(`Updater version must be ${version}`);
  const assets = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
  const { aliases, platforms } = releaseLayout(version);
  const expected = new Set(['latest.json', ...aliases.keys(), ...aliases.values()]);
  for (const [alias, original] of aliases) {
    if (
      assets.has(alias) &&
      assets.has(original) &&
      assets.get(alias).size !== assets.get(original).size
    ) {
      errors.push(`Stable alias differs in size from ${original}: ${alias}`);
    }
  }
  const prefix = `https://github.com/${repository}/releases/download/${tag}/`;
  let checkedPlatforms = 0;
  for (const [platform, asset] of platforms) {
    const entry = manifest.platforms?.[platform];
    // Six unsuffixed targets are the compatibility contract. Newer Tauri
    // actions also emit per-format entries; validate those when reported.
    const optional = /-(app|appimage|deb|rpm|msi|nsis)$/.test(platform);
    if (!entry && optional) continue;
    checkedPlatforms += 1;
    const allowed = (Array.isArray(asset) ? asset : [asset]).map((name) => `${prefix}${name}`);
    if (!entry || !allowed.includes(entry.url)) {
      errors.push(`Missing or incorrect updater URL: ${platform}`);
    } else {
      const name = entry.url.slice(prefix.length);
      expected.add(name);
      expected.add(`${name}.sig`);
    }
    if (typeof entry?.signature !== 'string' || !entry.signature.trim()) {
      errors.push(`Missing updater signature: ${platform}`);
    }
  }
  for (const name of expected) {
    if (!(assets.get(name)?.size > 0)) errors.push(`Missing or empty release asset: ${name}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { assets: expected.size, platforms: checkedPlatforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [releasePath, manifestPath, tag, repository] = process.argv.slice(2);
  if (!releasePath || !manifestPath || !tag || !repository) {
    throw new Error(
      'Usage: node scripts/verify-release.mjs <release.json> <latest.json> <tag> <owner/repo>',
    );
  }
  const result = verifyRelease({
    release: JSON.parse(readFileSync(releasePath, 'utf8')),
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
    tag,
    repository,
  });
  process.stdout.write(
    `Verified ${result.assets} required assets and ${result.platforms} updater targets for ${tag}.\n`,
  );
}
