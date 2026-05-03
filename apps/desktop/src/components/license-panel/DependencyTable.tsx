import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import type { LicenseScanResult } from '@/types';
import { RISK_LABEL, RISK_TONE } from './model';

const INITIAL_LIMIT = 100;

interface DependencyTableProps {
  entries: LicenseScanResult['entries'];
  expanded: boolean;
  onToggle: () => void;
}

export function DependencyTable({ entries, expanded, onToggle }: DependencyTableProps) {
  const [showAll, setShowAll] = useState(false);
  const total = entries.length;
  const visible = showAll ? entries : entries.slice(0, INITIAL_LIMIT);
  const truncated = !showAll && total > INITIAL_LIMIT;

  return (
    <div>
      <button
        type="button"
        className="text-fg-dim hover:text-fg flex items-center gap-1 text-[11px]"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {total} {total === 1 ? 'dependency' : 'dependencies'}
      </button>
      {expanded && (
        <div className="mt-2">
          <table className="w-full text-[11px]">
            <thead className="bg-surface-raised/40 sticky top-0 backdrop-blur">
              <tr className="text-fg-dim border-border border-b">
                <th className="px-2 py-1.5 text-left font-medium">Package</th>
                <th className="px-2 py-1.5 text-left font-medium">Version</th>
                <th className="px-2 py-1.5 text-left font-medium">License</th>
                <th className="px-2 py-1.5 text-left font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry, index) => (
                <tr key={index} className="border-border/40 hover:bg-surface-raised/40 border-b">
                  <td className="px-2 py-1 font-mono">{entry.name}</td>
                  <td className="text-fg-dim px-2 py-1 font-mono">{entry.version}</td>
                  <td className="px-2 py-1 font-mono">{entry.license}</td>
                  <td className="px-2 py-1">
                    <Badge tone={RISK_TONE[entry.risk]} size="xs">
                      {RISK_LABEL[entry.risk]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {truncated && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-accent hover:bg-accent/5 mt-1 block w-full rounded px-2 py-1.5 text-center text-[11px] font-medium transition"
            >
              Show all {total} packages...
            </button>
          )}
        </div>
      )}
    </div>
  );
}
