import { useMemo } from 'react';
import { History, PlayCircle, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { getLatestRelease } from '@/lib/whatsnew';
import { SettingsPageShell, SettingsSection } from '../SettingsView';

/**
 * About + onboarding aggregator.
 *
 * Lives separately from "Data & Cache" because these are
 * informational / re-discovery surfaces (version, what's new,
 * release notes, replay tour) rather than destructive maintenance
 * actions. Splitting them keeps the Danger Zone visually distinct
 * from "I want to look something up".
 */
export function AboutCategory({
  description,
  onReplayTour,
  closeSettings,
}: {
  description?: string;
  onReplayTour?: () => void;
  /**
   * Closing the Settings hub before opening What's New / Release
   * Notes prevents the modal stack from getting two layers deep,
   * which on macOS makes Escape ambiguous (does it close the
   * What's New, or Settings underneath?).
   */
  closeSettings: () => void;
}) {
  const appVersion = useAppStore((s) => s.appVersion);
  const openWhatsNew = useAppStore((s) => s.openWhatsNew);
  const openReleaseNotes = useAppStore((s) => s.openReleaseNotes);
  const latestRelease = useMemo(() => getLatestRelease(), []);

  return (
    <SettingsPageShell description={description}>
      <SettingsSection title="App information">
        <div className="border-border/50 bg-surface/40 rounded-app-sm grid grid-cols-2 gap-3 border p-3 text-[11px]">
          <InfoRow label="Version" value={appVersion ?? '—'} mono />
          <InfoRow label="Latest release notes" value={latestRelease?.version ?? '—'} mono />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Discoverability"
        description="Replay the welcome tour or revisit recent release highlights without scrolling through the changelog file."
      >
        <div className="flex flex-wrap gap-2">
          {onReplayTour && (
            <ActionTile
              icon={<PlayCircle className="h-4 w-4" />}
              label="Replay welcome tour"
              description="Walk through the first-launch onboarding overlays again."
              onClick={() => {
                closeSettings();
                onReplayTour();
              }}
            />
          )}
          {latestRelease && (
            <>
              <ActionTile
                icon={<Sparkles className="h-4 w-4" />}
                label={`What's new in ${latestRelease.version}`}
                description="Highlights of the most recent shipped release."
                onClick={() => {
                  closeSettings();
                  openWhatsNew(latestRelease.version);
                }}
              />
              <ActionTile
                icon={<History className="h-4 w-4" />}
                label="Release notes"
                description="Browse every release shipped to date."
                onClick={() => {
                  closeSettings();
                  openReleaseNotes();
                }}
              />
            </>
          )}
        </div>
      </SettingsSection>
    </SettingsPageShell>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-fg-dim text-[10px] tracking-wider uppercase">{label}</div>
      <div className={`text-fg mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function ActionTile({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border/50 bg-surface/40 hover:border-accent/40 hover:bg-accent/5 group rounded-app-sm flex min-w-[220px] flex-1 items-start gap-3 border px-3 py-2.5 text-left transition"
    >
      <div className="text-fg-dim group-hover:text-accent shrink-0 transition-colors">{icon}</div>
      <div className="min-w-0">
        <div className="text-fg text-[12px] font-medium">{label}</div>
        <div className="text-fg-dim mt-0.5 text-[10.5px] leading-snug">{description}</div>
      </div>
    </button>
  );
}
