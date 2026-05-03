import { useRef, type RefObject } from 'react';
import { ShieldCheck } from 'lucide-react';
import { buildAdvisoryChatPayload } from '@/lib/ai/advisoryPayload';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import type { Advisory } from '@/types';
import { AdvisoryRow } from './AdvisoryRow';
import { BulkBar } from './BulkBar';
import { EmptyState } from './EmptyState';
import { NotScannedState } from './NotScannedState';
import { SearchRow } from './SearchRow';
import { TriageRail } from './TriageRail';
import { ZeroState } from './ZeroState';
import {
  SEVERITY_ORDER,
  advisoryKey,
  capitalise,
  severityTone,
  upgradeCommandForAdvisory,
  type Severity,
} from './model';

export function AdvisoriesPanel({
  advisories,
  filtered,
  counts,
  query,
  setQuery,
  searchRef,
  severityFilter,
  setSeverityFilter,
  selected,
  toggle,
  selectAllVisible,
  clearSelection,
  hasScan,
  onOpenUrl,
  onRescan,
  scanning,
  runtime,
  projectName,
}: {
  advisories: Advisory[];
  filtered: Advisory[];
  counts: Record<Severity, number>;
  query: string;
  setQuery: (v: string) => void;
  searchRef: RefObject<HTMLInputElement>;
  severityFilter: Severity | 'all';
  setSeverityFilter: (v: Severity | 'all') => void;
  selected: Set<string>;
  toggle: (key: string) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
  hasScan: boolean;
  onOpenUrl: (url: string) => void;
  onRescan: () => void;
  scanning: boolean;
  runtime: string | null;
  projectName: string;
}) {
  // AI triage routes through the unified chat hub on the right
  // rail. The bulk button uses `useAiSurfaceTrigger` so a multi-
  // model setup gets a popover anchored under "Ask AI" instead of
  // bouncing the user into the panel and asking there.
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const {
    triggerRef: askAiTriggerRef,
    onClick: onAskAi,
    popover: askAiPopover,
  } = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: () => {
      const list = filteredRef.current;
      const payload = buildAdvisoryChatPayload({
        advisories: list,
        projectName,
        runtime,
      });
      return {
        origin: 'advisory',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
      };
    },
  });

  if (!hasScan) {
    return <NotScannedState kind="audit" onRescan={onRescan} scanning={scanning} />;
  }
  if (advisories.length === 0) {
    return (
      <ZeroState
        icon={<ShieldCheck size={32} className="text-tone-success/80" />}
        title="No known vulnerabilities"
        hint="The latest audit found no open CVEs for the direct or transitive dependencies of this project."
      />
    );
  }

  const total = advisories.length;
  const selectedCmds = filtered
    .filter((a, i) => selected.has(advisoryKey(a, i)))
    .map((a) => upgradeCommandForAdvisory(runtime, a))
    .filter((c): c is string => Boolean(c));

  // Dynamic button copy: tells the user *exactly* what'll get sent.
  // "Ask AI (12)" is far more honest than a generic "Ask AI" when
  // they've filtered to 12 critical rows out of 64 — the model
  // operates on the visible list, and the count makes that explicit.
  const askAiLabel =
    filtered.length === advisories.length ? `Ask AI (${total})` : `Ask AI (${filtered.length})`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TriageRail
        total={total}
        allLabel="All"
        active={severityFilter}
        onChange={(v) => setSeverityFilter(v as Severity | 'all')}
        tiles={SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => ({
          key: s,
          label: capitalise(s),
          count: counts[s],
          tone: severityTone(s),
        }))}
      />
      <SearchRow
        searchRef={searchRef}
        query={query}
        setQuery={setQuery}
        placeholder="Search package, CVE, title…"
        shown={filtered.length}
        total={total}
        selectedCount={selected.size}
        onSelectAll={selectAllVisible}
        onClearSelection={clearSelection}
        onAskAi={() => {
          if (filtered.length === 0) return;
          onAskAi();
        }}
        askAiLabel={askAiLabel}
        askAiDisabled={filtered.length === 0}
        askAiTriggerRef={askAiTriggerRef}
      />
      {askAiPopover}
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <EmptyState title="No matches" hint="Try clearing the search or the severity filter." />
        ) : (
          <ul className="py-1">
            {filtered.map((a, idx) => (
              <AdvisoryRow
                key={advisoryKey(a, idx)}
                advisory={a}
                selected={selected.has(advisoryKey(a, idx))}
                onToggle={() => toggle(advisoryKey(a, idx))}
                onOpenUrl={onOpenUrl}
                projectName={projectName}
                runtime={runtime}
              />
            ))}
          </ul>
        )}
      </div>
      <BulkBar selectedCount={selected.size} commands={selectedCmds} onClear={clearSelection} />
    </div>
  );
}
