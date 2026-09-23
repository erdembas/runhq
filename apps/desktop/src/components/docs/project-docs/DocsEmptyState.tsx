import * as i18n from '@runhq/cockpit-ui/i18n';
import { BookOpen } from 'lucide-react';

export function DocsEmptyState({ cwd }: { cwd: string }) {
  i18n.useLocale();
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="border-border/40 bg-surface-muted/40 max-w-md rounded-lg border px-6 py-8 text-center">
        <BookOpen className="text-fg-dim mx-auto mb-3 h-8 w-8" />
        <h3 className="text-fg text-[14px] font-semibold">{i18n.t('No documentation found')}</h3>
        <p className="text-fg-dim mt-2 text-[12.5px] leading-relaxed">
          {i18n.rich(
            'RunHQ looked for {value1}, {value2}, and a {value3} directory inside this project.',
            {
              value1: (
                <code className="bg-fg/10 text-fg rounded px-1 font-mono text-[11px]">
                  README.md
                </code>
              ),
              value2: (
                <code className="bg-fg/10 text-fg rounded px-1 font-mono text-[11px]">
                  CHANGELOG.md
                </code>
              ),
              value3: (
                <code className="bg-fg/10 text-fg rounded px-1 font-mono text-[11px]">docs/</code>
              ),
            },
          )}
        </p>
        <code className="text-fg-dim/80 mt-3 block truncate font-mono text-[11px]">{cwd}</code>
      </div>
    </div>
  );
}
