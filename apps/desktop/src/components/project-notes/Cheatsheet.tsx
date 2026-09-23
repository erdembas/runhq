import * as i18n from '@runhq/cockpit-ui/i18n';
import { HelpCircle } from 'lucide-react';

interface CheatsheetProps {
  onClose: () => void;
}

export function Cheatsheet({ onClose }: CheatsheetProps) {
  i18n.useLocale();
  return (
    <div
      role="dialog"
      aria-label={i18n.t('Markdown cheat sheet')}
      className="border-border bg-surface absolute right-3 bottom-3 z-20 w-[340px] overflow-hidden rounded-lg border shadow-lg"
    >
      <div className="border-border/60 flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="text-fg flex items-center gap-1.5 text-[12px] font-medium">
          {i18n.rich('{value1}Markdown cheat sheet', {
            value1: <HelpCircle className="text-fg-muted h-3.5 w-3.5" />,
          })}
        </div>
        <button type="button" onClick={onClose} className="text-fg-dim hover:text-fg text-[11px]">
          {i18n.t('Close')}
        </button>
      </div>
      <div className="max-h-[360px] space-y-3 overflow-y-auto p-3 text-[11px]">
        <CheatsheetSection title={i18n.t('Storage')}>
          <p className="text-fg/80 leading-relaxed">
            {i18n.rich(
              'Notes are local-only — they live in {value1} on this machine. Nothing here ends up in the project repo,{value2}, or remote sync.',
              {
                value1: (
                  <code className="text-fg/90 font-mono">
                    $RUNHQ_HOME/notes/&lt;service-id&gt;/&lt;name&gt;.md
                  </code>
                ),
                value2: <code className="text-fg/90 mx-1 font-mono">git status</code>,
              },
            )}
          </p>
          <p className="text-fg-muted mt-1 leading-relaxed">
            {i18n.t(
              "Safe for credentials, todos, half-formed thoughts, or anything you don't want in a commit.",
            )}
          </p>
        </CheatsheetSection>
        <CheatsheetSection title={i18n.t('Shortcuts')}>
          <ShortcutRow keys="⌘B" label={i18n.t('Bold')} />
          <ShortcutRow keys="⌘I" label={i18n.t('Italic')} />
          <ShortcutRow keys="⌘E" label={i18n.t('Inline code')} />
          <ShortcutRow keys="⌘K" label={i18n.t('Insert link')} />
          <ShortcutRow keys="⌘⇧H" label={i18n.t('Cycle heading level')} />
          <ShortcutRow keys="⌘⇧L" label={i18n.t('Toggle bullet list')} />
          <ShortcutRow keys="⌘⇧7" label={i18n.t('Toggle numbered list')} />
          <ShortcutRow keys="⌘⇧." label={i18n.t('Toggle block quote')} />
          <ShortcutRow keys="⌘F / ⌘H" label={i18n.t('Find / replace')} />
          <ShortcutRow keys="⌘D" label={i18n.t('Multi-cursor next match')} />
          <ShortcutRow keys="⌘S" label={i18n.t('Save')} />
        </CheatsheetSection>
        <CheatsheetSection title={i18n.t('Syntax')}>
          <SyntaxRow code="# H1, ## H2, ### H3" desc={i18n.t('Headings')} />
          <SyntaxRow code="**bold**, *italic*" desc={i18n.t('Emphasis')} />
          <SyntaxRow code="`inline`" desc={i18n.t('Inline code')} />
          <SyntaxRow code={'```bash\ncode block\n```'} desc={i18n.t('Fenced code (lang-tagged)')} />
          <SyntaxRow code="- item / 1. item" desc={i18n.t('Lists')} />
          <SyntaxRow code="> quote" desc={i18n.t('Block quote')} />
          <SyntaxRow code="[label](url)" desc={i18n.t('Link')} />
          <SyntaxRow code="![alt](url)" desc={i18n.t('Image')} />
          <SyntaxRow code={'| a | b |\n|---|---|'} desc={i18n.t('GFM table')} />
          <SyntaxRow code="- [ ] todo" desc={i18n.t('Task list')} />
        </CheatsheetSection>
      </div>
    </div>
  );
}

function CheatsheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  i18n.useLocale();
  return (
    <div>
      <div className="text-fg-muted mb-1 text-[10px] font-semibold tracking-wider uppercase">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  i18n.useLocale();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg/80">{label}</span>
      <kbd className="border-border bg-surface-muted text-fg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">
        {keys}
      </kbd>
    </div>
  );
}

function SyntaxRow({ code, desc }: { code: string; desc: string }) {
  i18n.useLocale();
  return (
    <div className="flex items-start justify-between gap-3">
      <code className="text-fg/80 font-mono text-[10.5px] whitespace-pre">{code}</code>
      <span className="text-fg-muted shrink-0 text-[10.5px]">{desc}</span>
    </div>
  );
}
