import { HelpCircle } from 'lucide-react';

interface CheatsheetProps {
  onClose: () => void;
}

export function Cheatsheet({ onClose }: CheatsheetProps) {
  return (
    <div
      role="dialog"
      aria-label="Markdown cheat sheet"
      className="border-border bg-surface absolute right-3 bottom-3 z-20 w-[340px] overflow-hidden rounded-lg border shadow-lg"
    >
      <div className="border-border/60 flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="text-fg flex items-center gap-1.5 text-[12px] font-medium">
          <HelpCircle className="text-fg-muted h-3.5 w-3.5" />
          Markdown cheat sheet
        </div>
        <button type="button" onClick={onClose} className="text-fg-dim hover:text-fg text-[11px]">
          Close
        </button>
      </div>
      <div className="max-h-[360px] space-y-3 overflow-y-auto p-3 text-[11px]">
        <CheatsheetSection title="Storage">
          <p className="text-fg/80 leading-relaxed">
            Notes are local-only — they live in{' '}
            <code className="text-fg/90 font-mono">
              $RUNHQ_HOME/notes/&lt;service-id&gt;/&lt;name&gt;.md
            </code>{' '}
            on this machine. Nothing here ends up in the project repo,
            <code className="text-fg/90 mx-1 font-mono">git status</code>, or remote sync.
          </p>
          <p className="text-fg-muted mt-1 leading-relaxed">
            Safe for credentials, todos, half-formed thoughts, or anything you don't want in a
            commit.
          </p>
        </CheatsheetSection>
        <CheatsheetSection title="Shortcuts">
          <ShortcutRow keys="⌘B" label="Bold" />
          <ShortcutRow keys="⌘I" label="Italic" />
          <ShortcutRow keys="⌘E" label="Inline code" />
          <ShortcutRow keys="⌘K" label="Insert link" />
          <ShortcutRow keys="⌘⇧H" label="Cycle heading level" />
          <ShortcutRow keys="⌘⇧L" label="Toggle bullet list" />
          <ShortcutRow keys="⌘⇧7" label="Toggle numbered list" />
          <ShortcutRow keys="⌘⇧." label="Toggle block quote" />
          <ShortcutRow keys="⌘F / ⌘H" label="Find / replace" />
          <ShortcutRow keys="⌘D" label="Multi-cursor next match" />
          <ShortcutRow keys="⌘S" label="Save" />
        </CheatsheetSection>
        <CheatsheetSection title="Syntax">
          <SyntaxRow code="# H1, ## H2, ### H3" desc="Headings" />
          <SyntaxRow code="**bold**, *italic*" desc="Emphasis" />
          <SyntaxRow code="`inline`" desc="Inline code" />
          <SyntaxRow code={'```bash\ncode block\n```'} desc="Fenced code (lang-tagged)" />
          <SyntaxRow code="- item / 1. item" desc="Lists" />
          <SyntaxRow code="> quote" desc="Block quote" />
          <SyntaxRow code="[label](url)" desc="Link" />
          <SyntaxRow code="![alt](url)" desc="Image" />
          <SyntaxRow code={'| a | b |\n|---|---|'} desc="GFM table" />
          <SyntaxRow code="- [ ] todo" desc="Task list" />
        </CheatsheetSection>
      </div>
    </div>
  );
}

function CheatsheetSection({ title, children }: { title: string; children: React.ReactNode }) {
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
  return (
    <div className="flex items-start justify-between gap-3">
      <code className="text-fg/80 font-mono text-[10.5px] whitespace-pre">{code}</code>
      <span className="text-fg-muted shrink-0 text-[10.5px]">{desc}</span>
    </div>
  );
}
