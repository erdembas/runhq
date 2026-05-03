import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileDown,
  HelpCircle,
  Info,
  Loader2,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DependencyTable } from '@/components/license-panel/DependencyTable';
import { WarningRow } from '@/components/license-panel/WarningRow';
import { IconButton } from '@/components/ui/IconButton';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import { buildLicenseChatPayload } from '@/lib/ai/licensePayload';
import type { LicenseScanResult } from '@/types';

interface Props {
  serviceId: string;
  serviceName: string;
  onClose: () => void;
}

export function LicensePanel({ serviceId, serviceName, onClose }: Props) {
  const [result, setResult] = useState<LicenseScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [writtenPath, setWrittenPath] = useState<string | null>(null);
  const [expandedWarnings, setExpandedWarnings] = useState(true);
  const [expandedDeps, setExpandedDeps] = useState(false);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await ipc.scanLicenses(serviceId);
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  const handleWriteNotices = useCallback(async () => {
    setWriting(true);
    setWrittenPath(null);
    try {
      const path = await ipc.writeThirdPartyNotices(serviceId);
      setWrittenPath(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setWriting(false);
    }
  }, [serviceId]);

  const canWriteNotices = result?.scan_supported && result.entries.length > 0;

  // AI triage trigger. Built lazily at click-time so the payload
  // captures the latest scan result (including any warnings the user
  // just rescanned into existence). The hook handles the 0-/1-/2+
  // -provider branching: empty config opens the panel with its own
  // banner, single config fires immediately, multi-provider pops a
  // model picker anchored under the trigger button.
  //
  // Stored in a ref + read inside `buildPayload` to avoid stale
  // closures — without this, clicking Ask AI right after a Rescan
  // would send the *old* result that was current when the trigger
  // first mounted, instead of the freshly-loaded one.
  const resultRef = useRef(result);
  resultRef.current = result;
  const {
    triggerRef: askAiTriggerRef,
    onClick: onAskAi,
    popover: askAiPopover,
  } = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: () => {
      const r = resultRef.current;
      if (!r) return null;
      const payload = buildLicenseChatPayload({
        result: r,
        projectName: serviceName,
        runtime: r.runtime,
      });
      return {
        origin: 'license',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
      };
    },
  });

  // Ask AI is meaningful even when the project has zero contamination
  // warnings — the bulk prompt happily analyses the distribution and
  // calls out unknowns the user might want to spot-check. We still
  // gate on having *some* scanned entries to avoid sending an empty
  // payload (e.g. unsupported runtime).
  const canAskAi = result?.scan_supported && result.entries.length > 0;
  const warningsCount = result?.contamination_warnings.length ?? 0;
  const askAiLabel = warningsCount > 0 ? `Ask AI (${warningsCount})` : 'Ask AI';

  // "Mostly unknown" guard — when the parser walked the dependency
  // tree but couldn't resolve license metadata for >70% of entries
  // (very common with `npm ls` outputs that omit the `license` field),
  // showing a green "✅ no contamination" banner is actively
  // misleading. We surface a softer "scan inconclusive" hint
  // instead so the user knows the absence-of-warnings is not the
  // same as a clean bill of health.
  const totalEntries = result?.entries.length ?? 0;
  const unknownRatio = result && totalEntries > 0 ? result.unknown_count / totalEntries : 0;
  const mostlyUnknown = totalEntries > 0 && unknownRatio >= 0.7;

  return (
    <div className="flex h-full flex-col">
      <header className="border-border shrink-0 border-b">
        <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
          <div className="flex items-center gap-2">
            <Scale className="text-fg-muted h-4 w-4 shrink-0" />
            <span className="text-fg text-[13px] font-medium">License Compliance</span>
          </div>
          <IconButton
            label="Close"
            icon={<X className="h-3.5 w-3.5" />}
            onClick={onClose}
            size="sm"
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="text-fg-dim min-w-0 truncate font-mono text-[11px]"
              title={serviceName}
            >
              {serviceName}
            </span>
            {result?.runtime && (
              <Badge tone="neutral" size="xs">
                {result.runtime}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="xs"
            leftIcon={
              loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )
            }
            onClick={() => void runScan()}
            disabled={loading}
          >
            {loading ? 'Scanning…' : 'Rescan'}
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && <div className="text-fg-dim text-[12px]">Scanning licenses…</div>}

        {error && (
          <p className="text-tone-critical-fg rounded-app border-tone-critical/30 bg-tone-critical/5 border p-2 text-[11px]">
            {error}
          </p>
        )}

        {result && !loading && (
          <div className="space-y-4">
            {/*
              Scan-not-supported banner. Renders when the backend has
              told us the runtime isn't (yet) covered by a working
              parser. Without this banner, a Python project would
              show a big green "✅ No copyleft contamination" — pure
              false confidence — because the entries list is empty
              by construction. We make the limitation visible up
              front so the user can opt for a manual review.
            */}
            {!result.scan_supported && (
              <div className="border-tone-warning/30 bg-tone-warning/5 rounded-app flex gap-2 border p-3">
                <Info className="text-tone-warning-fg mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1 text-[11px] leading-relaxed">
                  <p className="text-fg font-medium">
                    License scan limited{result.runtime ? ` for ${result.runtime}` : ''}
                  </p>
                  {result.scan_message && <p className="text-fg-dim">{result.scan_message}</p>}
                </div>
              </div>
            )}

            {/* Summary badges — only show non-zero counts. Rendering
                "0 permissive" used to anchor the row and read as a
                negative signal ("zero good things") when really
                permissive isn't even firing. With non-zero filtering
                the row reads as a true distribution: counts are what
                the user actually has. */}
            {result.scan_supported && result.entries.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.permissive_count + result.safe_count > 0 && (
                  <Badge tone="success" size="sm">
                    {result.permissive_count + result.safe_count} permissive
                  </Badge>
                )}
                {result.weak_copyleft_count > 0 && (
                  <Badge tone="warning" size="sm">
                    {result.weak_copyleft_count} weak copyleft
                  </Badge>
                )}
                {result.strong_copyleft_count > 0 && (
                  <Badge tone="critical" size="sm" icon={<AlertTriangle className="h-3 w-3" />}>
                    {result.strong_copyleft_count} strong copyleft
                  </Badge>
                )}
                {result.network_copyleft_count > 0 && (
                  <Badge tone="critical" size="sm" icon={<AlertTriangle className="h-3 w-3" />}>
                    {result.network_copyleft_count} network copyleft
                  </Badge>
                )}
                {result.proprietary_count > 0 && (
                  <Badge tone="warning" size="sm">
                    {result.proprietary_count} proprietary
                  </Badge>
                )}
                {result.unknown_count > 0 && (
                  <Badge tone="neutral" size="sm">
                    {result.unknown_count} unknown
                  </Badge>
                )}
              </div>
            )}

            {/* Contamination warnings */}
            {result.scan_supported &&
              result.has_contamination &&
              result.contamination_warnings.length > 0 && (
                <div className="border-tone-critical/30 bg-tone-critical/5 rounded-app border p-3">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left"
                    onClick={() => setExpandedWarnings(!expandedWarnings)}
                  >
                    {expandedWarnings ? (
                      <ChevronDown className="text-fg-muted h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="text-fg-muted h-3.5 w-3.5" />
                    )}
                    <ShieldAlert className="text-tone-critical-fg h-4 w-4" />
                    <span className="text-fg text-[12px] font-medium">
                      {result.contamination_warnings.length} contamination{' '}
                      {result.contamination_warnings.length === 1 ? 'warning' : 'warnings'}
                    </span>
                  </button>
                  {expandedWarnings && (
                    <ul className="mt-2 space-y-2 pl-5">
                      {result.contamination_warnings.map((w, i) => (
                        <WarningRow
                          key={`${w.package}@${w.version}@${i}`}
                          warning={w}
                          result={result}
                          projectName={serviceName}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}

            {/* No contamination — only render the green banner when
                we actually have license info for the majority of
                packages. Showing "✅ no contamination" on a tree
                where 3000 of 3662 packages are `unknown` would be
                the same false-confidence trap the scan_supported
                flag was added to fix.

                When the scan walked the tree but couldn't extract
                most licenses, fall back to an amber "inconclusive"
                hint so the user knows absence-of-warnings is not
                a clean bill of health. */}
            {result.scan_supported &&
              !result.has_contamination &&
              result.entries.length > 0 &&
              !mostlyUnknown && (
                <div className="border-tone-success/30 bg-tone-success/5 rounded-app flex items-center gap-2 border p-2.5 text-[12px]">
                  <ShieldCheck className="text-tone-success-fg h-4 w-4 shrink-0" />
                  <span className="text-fg">No copyleft contamination detected</span>
                </div>
              )}
            {result.scan_supported && mostlyUnknown && !result.has_contamination && (
              <div className="border-tone-warning/30 bg-tone-warning/5 rounded-app flex gap-2 border p-2.5 text-[11px] leading-relaxed">
                <HelpCircle className="text-tone-warning-fg mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-fg font-medium">Scan inconclusive</p>
                  <p className="text-fg-dim">
                    {result.unknown_count} of {totalEntries} packages didn't expose a license field,
                    so we can't certify this tree as contamination-free. Open the dependency list
                    below to spot-check the unknowns manually.
                  </p>
                </div>
              </div>
            )}

            {/* Dependency list (collapsible). The drawer container
                already owns vertical scroll, so we deliberately do
                NOT add a nested `max-h + overflow` here — nested
                scroll inside scroll is the kind of UX that nobody
                ever describes positively.

                For very large trees (npm projects routinely show
                3000+ entries via `npm ls --all`) we cap the
                rendered rows and let the user opt-in to the full
                list. Rendering 3000+ <tr>s on every panel open
                stalls the main thread for ~200ms; the cap keeps
                the open feeling instant. */}
            {result.entries.length > 0 && (
              <DependencyTable
                entries={result.entries}
                expanded={expandedDeps}
                onToggle={() => setExpandedDeps(!expandedDeps)}
              />
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                ref={askAiTriggerRef}
                variant="secondary"
                size="sm"
                leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                onClick={onAskAi}
                disabled={!canAskAi}
                title={
                  canAskAi
                    ? warningsCount > 0
                      ? `Triage ${warningsCount} license ${warningsCount === 1 ? 'warning' : 'warnings'} with AI — get a prioritised replacement plan`
                      : 'Analyse this license distribution with AI — even with no warnings, the model can flag unknowns to spot-check'
                    : 'Ask AI is unavailable — license scan did not run for this project'
                }
              >
                {askAiLabel}
              </Button>
              {askAiPopover}
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FileDown className="h-3.5 w-3.5" />}
                onClick={() => void handleWriteNotices()}
                disabled={writing || !canWriteNotices}
                title={
                  canWriteNotices
                    ? 'Write THIRD-PARTY-NOTICES.md to the project root'
                    : 'Nothing to write — license scan is unavailable for this project'
                }
              >
                {writing ? 'Writing…' : 'Write THIRD-PARTY-NOTICES.md'}
              </Button>
              {writtenPath && (
                <span className="text-fg-dim text-[11px]">
                  Written to <code className="font-mono">{writtenPath}</code>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
