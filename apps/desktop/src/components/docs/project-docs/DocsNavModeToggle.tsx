import * as i18n from '@runhq/cockpit-ui/i18n';
import { Folder, List } from 'lucide-react';
import { DocsNavModeButton } from './DocsNavModeButton';
import type { DocsNavMode } from './docsNavTypes';

interface DocsNavModeToggleProps {
  mode: DocsNavMode;
  onModeChange: (mode: DocsNavMode) => void;
}

export function DocsNavModeToggle({ mode, onModeChange }: DocsNavModeToggleProps) {
  i18n.useLocale();
  return (
    <div
      role="tablist"
      aria-label={i18n.t('Docs navigation mode')}
      className="border-border/70 bg-surface inline-flex rounded-md border p-0.5"
    >
      <DocsNavModeButton
        active={mode === 'flat'}
        icon={<List className="h-3 w-3" />}
        label={i18n.t('Flat list')}
        onClick={() => onModeChange('flat')}
      />
      <DocsNavModeButton
        active={mode === 'tree'}
        icon={<Folder className="h-3 w-3" />}
        label={i18n.t('Tree')}
        onClick={() => onModeChange('tree')}
      />
    </div>
  );
}
