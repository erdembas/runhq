import type { ReactNode } from 'react';
import { Eye, EyeOff, FolderSearch, Plus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { modChord } from '@/lib/platform';
import type { ServiceDef } from '@/types';

interface FreshWorkspaceEmptyProps {
  onScan: () => void;
  onAddService: (service: ServiceDef | null) => void;
}

interface HiddenProjectsEmptyProps {
  hiddenCount: number;
  onAddService: (service: ServiceDef | null) => void;
  onShowHidden: () => void;
}

export function FreshWorkspaceEmpty({ onScan, onAddService }: FreshWorkspaceEmptyProps) {
  return (
    <EmptyShell>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(600px 400px at 50% 30%, rgb(var(--accent) / 0.06), transparent 70%)',
        }}
      />
      <div className="glass animate-fade-in relative max-w-sm p-8 text-center">
        <div className="bg-accent/10 border-accent/30 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border">
          <Zap className="text-accent h-7 w-7" />
        </div>
        <h2 className="text-fg text-xl font-semibold tracking-tight">Ready when you are</h2>
        <p className="text-fg-muted mt-2 text-[13px] leading-relaxed">
          Point RunHQ at a project folder to auto-detect scripts, or add your first service
          manually.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<FolderSearch className="h-4 w-4" />}
            onClick={onScan}
            title="Walk known parent folders looking for new project directories"
          >
            Discover projects
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => onAddService(null)}
          >
            Add service{' '}
            <Kbd className="ml-1.5 border-transparent bg-white/20 text-white/90">
              {modChord('N')}
            </Kbd>
          </Button>
        </div>
      </div>
    </EmptyShell>
  );
}

export function HiddenProjectsEmpty({
  hiddenCount,
  onAddService,
  onShowHidden,
}: HiddenProjectsEmptyProps) {
  return (
    <EmptyShell>
      <div className="glass animate-fade-in relative max-w-md p-8 text-center">
        <div className="bg-fg-dim/10 border-fg-dim/30 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border">
          <EyeOff className="text-fg-muted h-7 w-7" />
        </div>
        <h2 className="text-fg text-xl font-semibold tracking-tight">
          {hiddenCount === 1 ? '1 project hidden' : `${hiddenCount} projects hidden`}
        </h2>
        <p className="text-fg-muted mt-2 text-[13px] leading-relaxed">
          Every registered project is flagged{' '}
          <span className="text-fg-dim font-mono text-[12px]">hide from dashboard</span>. Reveal
          them here, or open them from the sidebar / palette.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Eye className="h-4 w-4" />}
            onClick={onShowHidden}
          >
            Show hidden projects
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => onAddService(null)}
          >
            New service
          </Button>
        </div>
      </div>
    </EmptyShell>
  );
}

function EmptyShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface relative flex min-h-0 flex-1 overflow-hidden">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {children}
      </div>
    </div>
  );
}
