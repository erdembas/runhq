import { Apple, ArrowDownToLine, Boxes, MonitorPlay } from 'lucide-react';
import { CommandBlock } from './CommandBlock';
import { getReleaseInfo, resolveAssetHref, type ReleaseInfo } from '@/lib/release';

interface DownloadRow {
  /** Visible package-format label, e.g. `.dmg`. */
  label: string;
  /** Optional tooltip ("Debian, Ubuntu, …"). */
  hint?: string;
  /** One anchor per architecture in the row. */
  archs: Array<{
    /** Display label, e.g. `Intel`, `ARM64`. */
    label: string;
    /** Asset filename suffix used by `resolveAssetHref` to find the
     *  versioned URL. */
    suffix: string;
    /** Static fallback the legacy site already publishes via the
     *  `releases/latest/download/...` alias. */
    fallback: string;
  }>;
}

interface InstallCardConfig {
  os: 'macOS' | 'Linux' | 'Windows';
  versionHint: string;
  icon: React.ReactNode;
  /** Optional package-manager copy block above the binary downloads. */
  cmd?: { label: string; copy: string };
  rows: DownloadRow[];
  foot: string;
}

const RELEASE_BASE = 'https://github.com/erdembas/runhq/releases/latest/download';

const CARDS: InstallCardConfig[] = [
  {
    os: 'macOS',
    versionHint: '11+',
    icon: <Apple className="h-4 w-4" />,
    cmd: {
      label: 'Homebrew',
      copy: 'brew tap erdembas/tap\nbrew install --cask runhq',
    },
    rows: [
      {
        label: '.dmg',
        archs: [
          {
            label: 'Intel',
            suffix: '_x64.dmg',
            fallback: `${RELEASE_BASE}/runhq_x64.dmg`,
          },
          {
            label: 'Apple Silicon',
            suffix: '_aarch64.dmg',
            fallback: `${RELEASE_BASE}/runhq_aarch64.dmg`,
          },
        ],
      },
    ],
    foot: 'Cask postflight clears Gatekeeper quarantine. First launch is one click.',
  },
  {
    os: 'Linux',
    versionHint: 'x64 & ARM64',
    icon: <Boxes className="h-4 w-4" />,
    rows: [
      {
        label: '.deb',
        hint: 'Debian, Ubuntu, Pop!_OS',
        archs: [
          { label: 'x64', suffix: '_amd64.deb', fallback: `${RELEASE_BASE}/runhq_amd64.deb` },
          { label: 'ARM64', suffix: '_arm64.deb', fallback: `${RELEASE_BASE}/runhq_arm64.deb` },
        ],
      },
      {
        label: '.rpm',
        hint: 'Red Hat, Fedora, openSUSE',
        archs: [
          { label: 'x64', suffix: '.x86_64.rpm', fallback: `${RELEASE_BASE}/runhq_amd64.rpm` },
          { label: 'ARM64', suffix: '.aarch64.rpm', fallback: `${RELEASE_BASE}/runhq_arm64.rpm` },
        ],
      },
      {
        label: 'AppImage',
        hint: 'Universal — runs on any modern distro',
        archs: [
          {
            label: 'x64',
            suffix: '_amd64.AppImage',
            fallback: `${RELEASE_BASE}/runhq_amd64.AppImage`,
          },
          {
            label: 'ARM64',
            suffix: '_aarch64.AppImage',
            fallback: `${RELEASE_BASE}/runhq_arm64.AppImage`,
          },
        ],
      },
    ],
    foot: 'Every artifact is signed with the same minisign key the in-app updater verifies.',
  },
  {
    os: 'Windows',
    versionHint: '10 / 11',
    icon: <MonitorPlay className="h-4 w-4" />,
    rows: [
      {
        label: '.exe',
        hint: 'NSIS — recommended',
        archs: [
          {
            label: 'x64',
            suffix: '_x64-setup.exe',
            fallback: `${RELEASE_BASE}/runhq_x64-setup.exe`,
          },
          {
            label: 'ARM64',
            suffix: '_arm64-setup.exe',
            fallback: `${RELEASE_BASE}/runhq_arm64-setup.exe`,
          },
        ],
      },
      {
        label: '.msi',
        hint: 'MSI — for managed deployments',
        archs: [
          {
            label: 'x64',
            suffix: '_x64_en-US.msi',
            fallback: `${RELEASE_BASE}/runhq_x64.msi`,
          },
          {
            label: 'ARM64',
            suffix: '_arm64_en-US.msi',
            fallback: `${RELEASE_BASE}/runhq_arm64.msi`,
          },
        ],
      },
    ],
    foot: 'The in-app updater keeps it current — no reinstall needed between releases.',
  },
];

function InstallCard({ card, release }: { card: InstallCardConfig; release: ReleaseInfo }) {
  return (
    <article className="border-border bg-surface-overlay/50 flex flex-col gap-4 rounded-2xl border p-5">
      <div className="flex items-center gap-2.5">
        <div className="bg-surface-muted text-fg flex h-9 w-9 items-center justify-center rounded-lg">
          {card.icon}
        </div>
        <div>
          <div className="text-fg text-[15px] font-semibold">{card.os}</div>
          <div className="text-fg-dim text-[11px]">{card.versionHint}</div>
        </div>
      </div>

      {card.cmd && <CommandBlock copy={card.cmd.copy} display={`brew install --cask runhq`} />}

      {/* Download matrix — fixed-width label column + two equal-width
          arch tiles. Mirrors the legacy `.dl-row` 3-col grid so each
          card scans like a matrix and the visitor's eye locks onto
          the OS / format columns instead of chasing wrapped chips. */}
      <div className="flex flex-col gap-2">
        {card.rows.map((row) => (
          <div
            key={row.label}
            className="grid items-stretch gap-1.5"
            style={{ gridTemplateColumns: '92px minmax(0,1fr) minmax(0,1fr)' }}
          >
            <span
              className="border-border bg-surface-muted/60 text-fg-muted flex items-center justify-center rounded-md border px-2 font-mono text-[11.5px]"
              title={row.hint}
            >
              {row.label}
            </span>
            {row.archs.map((arch) => (
              <a
                key={arch.label}
                href={resolveAssetHref(release, arch.suffix, arch.fallback)}
                className="border-border bg-surface text-fg group hover:border-accent/50 hover:bg-accent/8 hover:text-accent flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition hover:-translate-y-0.5"
              >
                <ArrowDownToLine className="text-fg-dim group-hover:text-accent h-3.5 w-3.5 transition" />
                <span className="whitespace-nowrap">{arch.label}</span>
              </a>
            ))}
          </div>
        ))}
      </div>

      <p className="text-fg-dim border-border/60 mt-1 border-t pt-3 text-[11.5px] italic">
        {card.foot}
      </p>
    </article>
  );
}

export async function InstallSection() {
  const release = await getReleaseInfo();
  return (
    <section
      id="install"
      aria-labelledby="install-heading"
      className="border-border/60 border-t py-24"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-3">
          <span className="text-accent text-[11px] font-semibold tracking-[0.18em] uppercase">
            Install · macOS · Linux · Windows · {release.version}
          </span>
          <h2
            id="install-heading"
            className="text-fg max-w-3xl text-[36px] leading-[1.1] font-semibold tracking-[-0.02em]"
          >
            Install once. Stop rebuilding your setup.
          </h2>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {CARDS.map((card) => (
            <InstallCard key={card.os} card={card} release={release} />
          ))}
        </div>

        <p className="text-fg-muted mt-8 max-w-3xl text-[13px] leading-relaxed">
          Need an older version, the <code className="text-fg font-mono">.sig</code> alongside a
          binary, or the Tauri updater manifest?{' '}
          <a
            className="text-accent hover:underline"
            href="https://github.com/erdembas/runhq/releases"
          >
            Browse every release on GitHub
          </a>
          . Prefer source?{' '}
          <a
            className="text-accent hover:underline"
            href="https://github.com/erdembas/runhq#development"
          >
            <code className="font-mono">pnpm tauri:dev</code>
          </a>{' '}
          — Rust + pnpm, that&rsquo;s the full toolchain.
        </p>
      </div>
    </section>
  );
}
