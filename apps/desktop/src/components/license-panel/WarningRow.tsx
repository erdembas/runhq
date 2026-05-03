import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import { buildSingleLicenseChatPayload } from '@/lib/ai/licensePayload';
import { cn } from '@/lib/cn';
import type { ContaminationWarning, LicenseScanResult } from '@/types';
import { RISK_TONE } from './model';

/**
 * Single contamination warning, rendered as a list item with an
 * inline "Analyze with AI" Sparkles affordance.
 *
 * Extracted out of the parent `.map()` so each row can host its
 * own `useAiSurfaceTrigger` — the hook needs a stable trigger ref
 * + popover anchor per call site, and you can't legally call it
 * inside a `.map()` callback. Same architectural reason the
 * advisory list extracts `<AdvisoryRow>` instead of inlining.
 *
 * The Sparkles button is intentionally always visible (not a
 * hover-only affordance): per-warning analysis is the highest-
 * value action on the row, and hiding it behind hover would hide
 * the entire feature on first sight for new users.
 */
export function WarningRow({
  warning,
  result,
  projectName,
}: {
  warning: ContaminationWarning;
  result: LicenseScanResult;
  projectName: string;
}) {
  const {
    triggerRef: analyzeTriggerRef,
    onClick: onAnalyzeClick,
    popover: analyzePopover,
  } = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: () => {
      const payload = buildSingleLicenseChatPayload({
        warning,
        result,
        projectName,
        runtime: result.runtime,
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

  return (
    <li className="text-fg group/license-row text-[11px] leading-relaxed">
      <div className="flex min-w-0 items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <span className="font-medium">{warning.package}</span> v{warning.version}{' '}
          <Badge tone={RISK_TONE[warning.risk]} size="xs" className="ml-1">
            {warning.license}
          </Badge>
          <p className="text-fg-dim mt-0.5">{warning.message}</p>
        </div>
        <button
          ref={analyzeTriggerRef}
          type="button"
          onClick={onAnalyzeClick}
          className={cn(
            'text-fg/55 hover:text-accent hover:bg-accent/10 mt-0.5 inline-flex shrink-0 items-center',
            'gap-0.5 rounded px-1 py-0.5 transition',
            'group-hover/license-row:text-accent/80',
          )}
          title={`Analyze \`${warning.package}\` (${warning.license}) with AI`}
          aria-label={`Analyze ${warning.package} license risk with AI`}
        >
          <Sparkles size={11} />
        </button>
        {analyzePopover}
      </div>
    </li>
  );
}
