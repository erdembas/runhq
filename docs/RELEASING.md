# Releasing & Distribution

This document describes how RunHQ releases are cut, how versions propagate across the monorepo, and how users install the application across macOS, Windows, and Linux.

RunHQ uses **[Release Please](https://github.com/googleapis/release-please)** to automate versioning and changelog generation from [Conventional Commits](https://www.conventionalcommits.org/). You almost never bump a version by hand.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Versioning Policy](#versioning-policy)
- [Conventional Commits Cheat Sheet](#conventional-commits-cheat-sheet)
- [Normal Release Flow](#normal-release-flow)
  - [1. Land commits on `main`](#1-land-commits-on-main)
  - [2. Release Please opens a Release PR](#2-release-please-opens-a-release-pr)
  - [3. Merging the Release PR](#3-merging-the-release-pr)
  - [4. Binary build & publish](#4-binary-build--publish)
- [Prerequisites (one-time setup)](#prerequisites-one-time-setup)
  - [1. Generate Tauri updater signing keys](#1-generate-tauri-updater-signing-keys)
  - [2. Add GitHub Secrets](#2-add-github-secrets)
  - [3. Set the public key in config](#3-set-the-public-key-in-config)
  - [4. Create the Homebrew tap repository](#4-create-the-homebrew-tap-repository)
  - [5. Create the baseline tag](#5-create-the-baseline-tag)
- [macOS Code Signing Strategy](#macos-code-signing-strategy)
- [Manual Overrides](#manual-overrides)
  - [Forcing a specific version](#forcing-a-specific-version)
  - [Cutting an emergency hotfix](#cutting-an-emergency-hotfix)
  - [Pre-releases / release candidates](#pre-releases--release-candidates)
- [Distribution Channels](#distribution-channels)
  - [GitHub Releases](#github-releases)
  - [Homebrew (macOS)](#homebrew-macos)
  - [Winget (Windows)](#winget-windows)
  - [Linux](#linux)
- [Auto-Update System](#auto-update-system)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
Developer pushes conventional commits to `main`
       │
       ▼
┌──────────────────────────────┐
│  release-please.yml workflow │
│  analyses commits since tag  │
└──────────┬───────────────────┘
           │
           ▼  (opens/updates a single rolling "Release PR")
┌──────────────────────────────┐
│  Release PR                  │
│  • version bumped in 5 files │
│  • CHANGELOG.md updated      │
└──────────┬───────────────────┘
           │   Maintainer reviews → merges
           ▼
┌──────────────────────────────┐
│  release-please              │
│  • creates git tag  v0.x.y   │
│  • creates GitHub Release    │
└──────────┬───────────────────┘
           │   Release published event
           ▼
┌──────────────────────────────┐
│  release.yml CI              │
│  builds installers in parallel│
│  (macOS ARM + x64, Linux, Win)│
└──────────┬───────────────────┘
           │
           ├──► Uploads DMG / MSI / EXE / DEB / AppImage to the Release
           │
           ├──► Uploads signed `latest.json` (Tauri updater manifest)
           │
           └──► Auto-updates the Homebrew tap (erdembas/homebrew-tap)

Installed apps auto-update by polling the Cloudflare-proxied endpoint:
    https://runhq.dev/api/updates/latest   →  proxies to `latest.json`
```

---

## Versioning Policy

RunHQ follows **[Semantic Versioning 2.0.0](https://semver.org/)**: `MAJOR.MINOR.PATCH`.

| Change                                      | Pre-1.0 behaviour                | Post-1.0 behaviour |
| ------------------------------------------- | -------------------------------- | ------------------ |
| `feat:`                                     | Bumps MINOR                      | Bumps MINOR        |
| `fix:`, `perf:`, `refactor:`                | Bumps PATCH                      | Bumps PATCH        |
| `feat!:` or `BREAKING CHANGE:` footer       | Bumps MINOR (pre-1.0 convention) | Bumps MAJOR        |
| `docs:`, `chore:`, `ci:`, `test:`, `style:` | No bump                          | No bump            |

The single source of truth for the current version is `.github/.release-please-manifest.json`. Release Please keeps the following five files in sync from there:

- `package.json` (root)
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml` (anchored by `# x-release-please-version`)
- `crates/runhq-core/Cargo.toml` (anchored by `# x-release-please-version`)

**Do not edit these version fields manually.** Let Release Please do it — otherwise the manifest drifts out of sync and the next release will misbehave.

---

## Conventional Commits Cheat Sheet

Every commit on `main` should follow this format:

```
<type>(<scope>): <short imperative subject>

<optional body explaining the "why">

<optional footer, e.g. `BREAKING CHANGE:` or `Refs: #123`>
```

### Common types

| Type       | When to use                                 | Example                                             |
| ---------- | ------------------------------------------- | --------------------------------------------------- |
| `feat`     | User-facing new capability                  | `feat(desktop): add service group quick switcher`   |
| `fix`      | Bug fix visible to users                    | `fix(core): handle orphan child processes on Linux` |
| `perf`     | Performance improvement                     | `perf(scanner): cache directory reads`              |
| `refactor` | Internal restructuring, no behaviour change | `refactor(ipc): extract dispatch into trait`        |
| `docs`     | Documentation only                          | `docs(readme): clarify install steps`               |
| `test`     | Test-only changes                           | `test(core): cover SIGTERM reaping`                 |
| `build`    | Build system / toolchain                    | `build: migrate Tailwind v3 → v4`                   |
| `ci`       | CI/CD pipeline changes                      | `ci: add release-please workflow`                   |
| `chore`    | Housekeeping, deps, configs                 | `chore(deps): bump tauri 2.1 → 2.2`                 |
| `style`    | Formatting, no logic                        | `style: apply prettier to docs/`                    |
| `revert`   | Reverting a prior commit                    | `revert: feat(desktop): drop group switcher`        |

### Scopes used in this repo

- `desktop` — anything in `apps/desktop/src/**`
- `core` — anything in `crates/runhq-core/**`
- `tauri` — anything in `apps/desktop/src-tauri/**`
- `docs` — content under `docs/**`
- `ci`, `deps`, `build` — self-explanatory

### Breaking changes

Either append `!` after the type/scope **or** add a `BREAKING CHANGE:` footer:

```
feat(core)!: rename RunConfig to ServiceConfig

BREAKING CHANGE: The Rust struct `RunConfig` has been renamed to
`ServiceConfig`. All consumers must update imports.
```

Both forms trigger a MAJOR bump (after 1.0).

---

## Normal Release Flow

This is the happy path you'll use 95% of the time. You do **not** run any release commands manually.

### 1. Land commits on `main`

Work on a feature branch, open a PR, merge it with **squash-merge** so that the commit on `main` uses the PR title as its commit message. The `Validate PR title` check enforces Conventional Commits on PR titles.

```bash
git checkout -b feat/service-groups
# ... work, commit ...
git push -u origin feat/service-groups
gh pr create --fill
# after review, squash-merge from GitHub UI
```

> ⚠️ **Do not** rewrite or edit the commit subject when squashing. Release Please reads the exact Conventional Commit wording to decide version bumps and generate the changelog.

### 2. Release Please opens a Release PR

As soon as a qualifying commit (`feat:`, `fix:`, `perf:`, etc.) lands on `main`, the `release-please.yml` workflow:

1. Walks the git history since the previous tag (e.g. `v0.1.0`).
2. Aggregates the commits and computes the next version.
3. Opens (or updates, if already open) a single Release PR titled:

   ```
   chore: release 0.2.0
   ```

   The PR body contains the auto-generated changelog. Its diff touches only:
   - `CHANGELOG.md` (new section at the top)
   - The five version fields listed in [Versioning Policy](#versioning-policy)
   - `.github/.release-please-manifest.json`

You can keep merging more `feat:` / `fix:` commits onto `main` while the Release PR is open — Release Please will keep updating both the version and the changelog on the PR in place. The Release PR is a **rolling, batched release candidate**.

### 3. Merging the Release PR

When you decide the batch is ready to ship:

1. Open the Release PR, re-read the generated changelog.
2. Make sure all required status checks are green (CI, Cloudflare Pages preview, etc.).
3. **Squash-merge** the Release PR.

Release Please reacts to the merge by:

- Creating a git tag `vX.Y.Z` pointing at the merge commit.
- Creating a **published** GitHub Release with the changelog as its body.
- Marking the Release PR as closed.

### 4. Binary build & publish

The published GitHub Release triggers `release.yml`:

1. Builds in parallel: **macOS** (aarch64 + x86_64), **Linux** (amd64), **Windows**.
2. Uploads the installers to the same GitHub Release:
   - `RunHQ_{ver}_aarch64.dmg`, `RunHQ_{ver}_x64.dmg`
   - `RunHQ_{ver}_x64_en-US.msi`, `RunHQ_{ver}_x64-setup.exe`
   - `RunHQ_{ver}_amd64.deb`, `RunHQ_{ver}_amd64.AppImage`
3. Generates and signs `latest.json` (the Tauri updater manifest) and attaches it.
4. Pushes the updated Cask to `erdembas/homebrew-tap`.

Once assets are uploaded, installed apps on user machines pick up the update through the [Auto-Update System](#auto-update-system) on their next launch.

> 💡 If you want to sanity-check before users see the release, you can toggle `"draft": true` in `.github/release-please-config.json`. In that mode the Release is created as a draft and you must click **Publish** manually in the GitHub UI.

---

## Prerequisites (one-time setup)

These steps only need to happen once per repo / per maintainer machine.

### 1. Generate Tauri updater signing keys

Tauri v2 updater requires signed update artifacts so installed apps can trust the manifest.

```bash
pnpm --filter @runhq/desktop tauri signer generate -w ~/.tauri/RunHQ.key
```

This outputs a **public key** and a **private key** (encrypted with a password you choose). The public key goes into `tauri.conf.json` (see step 3); the private key goes into GitHub Secrets (step 2).

### 2. Add GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret                               | Value                                                        |
| ------------------------------------ | ------------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Private key content from step 1                              |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you chose in step 1                                 |
| `HOMEBREW_TAP_TOKEN`                 | A PAT with `repo` scope (to push to `erdembas/homebrew-tap`) |

Optional Apple Developer ID secrets — only needed if you want to upgrade from ad-hoc to notarized builds (see [macOS Code Signing Strategy](#macos-code-signing-strategy)):

| Secret                       | Value                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64-encoded `.p12` (Developer ID Application cert + private key)                      |
| `APPLE_CERTIFICATE_PASSWORD` | Password protecting the `.p12`                                                           |
| `APPLE_SIGNING_IDENTITY`     | e.g. `Developer ID Application: Your Name (TEAM_ID)`                                     |
| `APPLE_ID`                   | Apple ID email used to enrol in the Developer Program                                    |
| `APPLE_PASSWORD`             | App-specific password from [appleid.apple.com](https://appleid.apple.com/account/manage) |
| `APPLE_TEAM_ID`              | 10-character Team ID (e.g. `AB12CD34EF`)                                                 |

### 3. Set the public key in config

Open `apps/desktop/src-tauri/tauri.conf.json` and set the `pubkey` to the public key from step 1:

```json
"plugins": {
  "updater": {
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6..."
  }
}
```

### 4. Create the Homebrew tap repository

1. Create a new GitHub repo: `erdembas/homebrew-tap` (generic tap name so it can host additional casks later — users install via `brew tap erdembas/tap`).
2. Add a `Casks/` directory.
3. Copy `scripts/homebrew-cask-template.rb` as `Casks/runhq.rb`.

The release workflow will auto-update this file on every release.

### 5. Create the baseline tag

Release Please computes bumps relative to the previous tag. The very first time you enable it, create a baseline tag matching the current manifest:

```bash
git tag -a v0.1.0 -m "Initial baseline release"
git push origin v0.1.0
```

After this, Release Please will open its first Release PR as soon as the next `feat:` / `fix:` commit lands.

---

## macOS Code Signing Strategy

RunHQ intentionally ships **without** an Apple Developer Program membership. The resulting user experience is designed to feel just as clean as a notarized app through Homebrew, and only slightly rougher through a direct DMG download.

### How it works today

1. **Ad-hoc full-bundle signing during build.** `apps/desktop/src-tauri/tauri.conf.json` sets `bundle.macOS.signingIdentity: "-"`. This tells Tauri to invoke `codesign --force --deep --sign -` on the whole `.app`, producing a signature with sealed resources (`_CodeSignature/CodeResources`). Without this, Gatekeeper on macOS 14+ rejects the app with _"RunHQ is damaged and can't be opened"_ because Tauri's default build only linker-signs the inner Mach-O binary, leaving the bundle unsealed.

2. **Brew postflight strips the quarantine xattr.** When the user runs `brew install --cask runhq`, the cask's `postflight` block runs `xattr -cr /Applications/RunHQ.app`. macOS treats apps without a `com.apple.quarantine` xattr as not-from-the-internet and skips the Gatekeeper assessment entirely — the app opens on first double-click with no warnings.

3. **Direct DMG downloads are intentionally rougher.** Users who prefer `.dmg` files over brew see _"Can't be opened because it's from an unidentified developer"_ on first launch. They can right-click → Open once, or run the documented `xattr -cr /Applications/RunHQ.app` escape hatch. We document both paths in the user-facing README.

### What an ad-hoc signature does NOT give you

- **App Store distribution** — needs a Mac App Store provisioning profile.
- **Automatic Gatekeeper approval** on first launch for direct downloads.
- **Certain macOS system entitlements** (hardened runtime with custom entitlements, push notifications, iCloud containers, etc.) — RunHQ doesn't currently need any of them.
- **User trust signalling** — `spctl -a -vv` will say `source=No Matching Rule` instead of `source=Notarized Developer ID`.

For a local dev tool used by developers, this trade-off is acceptable. If RunHQ ever reaches a more mainstream audience (or we just want to kill that one rough edge), we can upgrade to notarized builds with zero code changes — see below.

### Optional upgrade path: Apple Developer ID + notarization

> **Status:** `release.yml` is **wired and ready** as of `9574aed`. Two
> sibling `Build` steps run conditionally: a notarized one fires only
> when the job-level boolean `APPLE_CERT_PRESENT == 'true'` (i.e. the
> `APPLE_CERTIFICATE` secret is non-empty), and a default one fires
> for every other case (Linux, Windows, and macOS without secrets).
> Empty secrets are never piped into `tauri-action`, so the "damaged
> v0.1.2" `security: import` crash cannot recur. Populate the six
> `APPLE_*` secrets and the very next tag flips macOS into notarized
> output — no workflow edit required.

When all six of `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are populated, `tauri-action` will:

1. Import the `.p12` into a temporary keychain on the macOS runner.
2. Sign the `.app` with `Developer ID Application` instead of `-`.
3. Submit the DMG to Apple for notarization via `xcrun notarytool`.
4. Staple the resulting ticket to the DMG so Gatekeeper approves it offline.

When/if you're ready to go down this path:

<details>
<summary>Full Developer ID setup (click to expand)</summary>

#### Enroll in the Apple Developer Program

Go to [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) and enroll as an **individual** (fastest, no D-U-N-S number required). Approval typically takes 24–48 h. The fee is \$99/year.

Write down your **10-character Team ID** — visible at [developer.apple.com/account](https://developer.apple.com/account) → Membership details.

#### Create a Developer ID Application certificate

1. Open **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**, save the CSR to disk.
2. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list), click **+** → **Developer ID Application**, upload the CSR, download the `.cer`.
3. Double-click the `.cer` to import into Keychain Access (**login** keychain → **My Certificates**).

#### Export as password-protected `.p12`

In Keychain Access, find **Developer ID Application: Your Name (TEAM_ID)**, expand so the cert and private key are selected together, right-click → **Export 2 items…** → `.p12` with a strong password.

#### Base64-encode for GitHub Secrets

```bash
base64 -i ~/Downloads/RunHQ-DeveloperID.p12 | pbcopy
```

#### Create an app-specific password

At [appleid.apple.com](https://appleid.apple.com/account/manage) → **Sign-In and Security → App-Specific Passwords**, generate one labelled `RunHQ Notarization`. Copy the `abcd-efgh-ijkl-mnop` format password.

#### Find your signing identity string

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
# 1) ABCDEF1234... "Developer ID Application: Your Name (AB12CD34EF)"
```

The full string in quotes is `APPLE_SIGNING_IDENTITY`; the parenthesized suffix is `APPLE_TEAM_ID`.

#### Populate the six optional secrets

Set every Apple secret listed in [step 2](#2-add-github-secrets). The next release cycle picks them up automatically — no code changes needed.

#### Verify notarization worked

```bash
spctl -a -vv /Applications/RunHQ.app
# Expected:  accepted  source=Notarized Developer ID

codesign -dv --verbose=4 /Applications/RunHQ.app 2>&1 | grep -E "Authority|TeamIdentifier"
# Expected:  Authority=Developer ID Application: Your Name (TEAM_ID)
#            Authority=Developer ID Certification Authority
#            Authority=Apple Root CA
#            TeamIdentifier=TEAM_ID
```

Once this is live, you can safely drop the `xattr -cr` postflight from `homebrew-tap.yml` — notarized + stapled binaries don't need it. We deliberately keep the postflight for now because it's a no-op on notarized apps but saves ad-hoc users from the "unidentified developer" dialog.

</details>

---

## Manual Overrides

Use these sparingly. They exist for genuine edge cases.

### Forcing a specific version

Append a `Release-As:` trailer to any commit message on `main`:

```bash
git commit --allow-empty -m "chore: cut 1.0.0

Release-As: 1.0.0"
git push origin main
```

Release Please will open a Release PR bumping directly to `1.0.0`, regardless of what the commit history would otherwise imply. Use this to:

- Promote from `0.x` to `1.0.0` when the API is stable.
- Jump to a marketing-aligned version.
- Recover from a botched version that needs to be skipped.

### Cutting an emergency hotfix

If a critical `fix:` needs to ship **now** without waiting for batched commits:

1. Land the `fix:` commit on `main`.
2. Wait ~1 minute for Release Please to open/update the Release PR.
3. Squash-merge the Release PR immediately.

The binary build pipeline takes over from there.

### Pre-releases / release candidates

Not currently wired up. To enable, set `"prerelease": true` in `.github/release-please-config.json` and use a `Release-As:` trailer like `Release-As: 1.0.0-rc.1`. Tags of the form `vX.Y.Z-rc.N` are treated as pre-releases by GitHub and should be excluded from the `latest.json` feed manually (or via a dedicated pre-release channel — future work).

---

## Distribution Channels

### GitHub Releases

Every release includes:

| Platform              | Files                                                 | Install                         |
| --------------------- | ----------------------------------------------------- | ------------------------------- |
| macOS (Apple Silicon) | `RunHQ_{ver}_aarch64.dmg`                             | Open DMG → drag to Applications |
| macOS (Intel)         | `RunHQ_{ver}_x64.dmg`                                 | Open DMG → drag to Applications |
| Windows               | `RunHQ_{ver}_x64_en-US.msi` / `.exe`                  | Double-click installer          |
| Linux                 | `RunHQ_{ver}_amd64.deb`, `RunHQ_{ver}_amd64.AppImage` | `dpkg -i` or `chmod +x && ./`   |

### Homebrew (macOS)

```bash
brew tap erdembas/tap
brew install --cask RunHQ
```

Users update with:

```bash
brew upgrade --cask RunHQ
```

The Cask file is automatically updated by the release workflow.

### Winget (Windows)

After the first release is published:

```bash
./scripts/generate-winget-manifest.sh 0.1.0
```

This creates manifest YAML files under `winget-manifests/`. Then:

1. Fork `https://github.com/microsoft/winget-pkgs`.
2. Copy the manifests to `manifests/e/erdembas/RunHQ/{version}/`.
3. Replace `{REPLACE_WITH_PRODUCT_CODE_GUID}` in the installer manifest (use `orca` or `lessmsi` to extract from the MSI).
4. Open a PR against `winget-pkgs`.

Once merged, users can install with:

```powershell
winget install erdembas.RunHQ
```

### Linux

The CI produces both `.deb` and `.AppImage`:

```bash
# Debian/Ubuntu
sudo dpkg -i RunHQ_0.1.0_amd64.deb

# Any distro (AppImage)
chmod +x RunHQ_0.1.0_amd64.AppImage
./RunHQ_0.1.0_amd64.AppImage
```

---

## Auto-Update System

RunHQ uses the built-in Tauri v2 updater. After the initial install:

1. On every app launch, the frontend calls `check()` from `@tauri-apps/plugin-updater`.
2. If a new version is available, a banner appears: "RunHQ X.Y.Z available — Update & Restart".
3. Clicking the button downloads the new installer, verifies its signature, installs, and relaunches the app.

The updater endpoints (in order, with automatic fallback) are:

1. `https://runhq.dev/api/updates/latest` — Cloudflare Pages Function that proxies the GitHub manifest, adds edge caching, and isolates clients from GitHub rate limits.
2. `https://github.com/erdembas/runhq/releases/latest/download/latest.json` — direct fallback to the GitHub Release asset.

The `latest.json` file is generated automatically by `tauri-apps/tauri-action` during `release.yml` and signed with the private key stored in `TAURI_SIGNING_PRIVATE_KEY`.

---

## Troubleshooting

### Release PR didn't appear after a `feat:` / `fix:` commit

- Check the **Actions → Release Please** run for errors.
- Verify the commit subject on `main` actually follows Conventional Commits (squash-merges sometimes drop the format).
- Ensure `.github/.release-please-manifest.json` exists and is valid JSON.
- Ensure a baseline tag (e.g. `v0.1.0`) exists and points into the main branch history.

### Release PR has no version bump / empty changelog

- Only `feat:`, `fix:`, `perf:`, `refactor:`, `revert:`, `docs:`, `build:` appear in the changelog by default. `chore:` / `ci:` / `test:` / `style:` are hidden (see `changelog-sections` in `release-please-config.json`).
- If every commit since the last tag is hidden, Release Please won't open a PR.

### Versions are out of sync across files

This can happen if someone hand-edited a version field. To recover:

1. Decide the correct current version.
2. Set it in `.github/.release-please-manifest.json` and all five tracked files manually.
3. Commit as `chore: resync version manifests` on `main`.
4. The next `feat:` / `fix:` commit will bring the Release PR back in sync.

### Release CI failed

Check the workflow logs in **Actions → Release**. Common issues:

- Missing `TAURI_SIGNING_PRIVATE_KEY` secret.
- Linux dependency installation failure (transient apt issues — just re-run the job).
- Frontend build errors (run `pnpm typecheck && pnpm build` locally first).

### Users see "RunHQ is damaged and can't be opened" on first launch

This means the `.app` reached the user without a sealed signature. Diagnose in order:

1. **Confirm the build produced an ad-hoc sealed bundle.** On any copy of the installed app, run:

   ```bash
   codesign -dv --verbose=4 /Applications/RunHQ.app 2>&1 | grep -E "Signature|Sealed"
   # Good:  Signature=adhoc  (a full line)
   #        Sealed Resources version=2 rules=13 files=<N>
   # Bad:   Signature=adhoc  (linker-signed)
   #        Sealed Resources=none
   ```

   If you see `Sealed Resources=none`, the `bundle.macOS.signingIdentity: "-"` setting in `tauri.conf.json` isn't taking effect — check the CI build logs for a `codesign --force --deep --sign -` line. Clean the runner cache and re-release.

2. **Confirm the cask postflight ran.** For brew installs, check:

   ```bash
   xattr -l /Applications/RunHQ.app
   # Expected after brew install: empty output
   # If you see com.apple.quarantine, postflight didn't fire.
   ```

   Usual causes: user installed the app before the cask in the tap contained the postflight block (re-run `brew reinstall --cask runhq`), or a Homebrew version quirk. Always test the current tap cask on a clean account before cutting a release.

3. **Direct DMG users just need the escape hatch.** Point them to the README's `xattr -cr /Applications/RunHQ.app` one-liner, or the right-click → Open fallback. This is expected behaviour for ad-hoc signed apps.

### Optional Developer ID path failed

Only relevant if you've populated the `APPLE_*` secrets. Open the macOS job log and look for:

- `Skipping code signing ...` — at least one `APPLE_*` secret is missing. Double-check all six exist.
- `security: SecKeychainItemImport: MAC verification failed during PKCS12 import` — `APPLE_CERTIFICATE_PASSWORD` is wrong, or the `.p12` was re-generated without a password, or base64 was copied with stray whitespace. Re-export the `.p12` and re-run `base64 -i ... | pbcopy`.
- `notarytool: HTTP 401` — `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` mismatch. `APPLE_PASSWORD` must be an _app-specific_ password from [appleid.apple.com](https://appleid.apple.com/account/manage), never your real iCloud password.
- `notarytool submit ... status: Invalid` — submission reached Apple but was rejected. Download the full log from the URL in the CI output; 90% of the time it's an unsigned nested binary Tauri bundled (a sidecar or helper app) that needs explicit signing.
- `.app` is signed but not stapled — run `stapler validate /Applications/RunHQ.app`; if it says `CloudKit Record Not Found`, notarization hadn't finished when CI exited. Trigger `workflow_dispatch` on `release.yml` for the same tag to re-run.

### Homebrew tap not updated

- Verify `HOMEBREW_TAP_TOKEN` is valid and has `repo` scope.
- Verify `erdembas/homebrew-tap` exists with a `Casks/` directory.

### Updater not working on installed app

- Ensure `createUpdaterArtifacts: "v2Compatible"` is in `tauri.conf.json`.
- Ensure the public key in `tauri.conf.json` matches the private key in secrets.
- Check that `latest.json` exists in the GitHub Release assets and returns HTTP 200 from both updater endpoints:

  ```bash
  curl -s https://runhq.dev/api/updates/latest | head -c 200
  curl -sL https://github.com/erdembas/runhq/releases/latest/download/latest.json | head -c 200
  ```

- If the proxy endpoint returns a 502, check Cloudflare Pages Function logs — most failures come from upstream rate limits or an outage on GitHub.
