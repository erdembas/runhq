import * as i18n from '@runhq/cockpit-ui/i18n';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Terminal, X } from 'lucide-react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { TerminalPane } from '@/components/TerminalPane';
import { cn } from '@/lib/cn';

interface Props {
  children: ReactNode;
  sessionId: string;
  cwd: string;
  terminalOpen: boolean;
  onHideTerminal: () => void;
}

export function AgentTaskTerminalDock({
  children,
  sessionId,
  cwd,
  terminalOpen,
  onHideTerminal,
}: Props) {
  i18n.useLocale();
  const viewId = useId();
  const terminalPanel = useRef<ImperativePanelHandle>(null);
  const expandedSize = useRef(35);
  const syncingVisibility = useRef(false);
  const [terminalCreated, setTerminalCreated] = useState(terminalOpen);

  useLayoutEffect(() => {
    syncingVisibility.current = true;
    try {
      if (terminalOpen) {
        setTerminalCreated(true);
        terminalPanel.current?.resize(expandedSize.current);
      } else {
        terminalPanel.current?.collapse();
      }
    } finally {
      syncingVisibility.current = false;
    }
  }, [terminalOpen]);

  return (
    <PanelGroup direction="vertical" className="min-h-0 flex-1">
      {/* Keep the conversation under the same parent when opening the terminal so drafts survive. */}
      <Panel order={1} defaultSize={terminalOpen ? 65 : 100} minSize={25}>
        <div className="flex h-full min-h-0 flex-col">{children}</div>
      </Panel>
      <PanelResizeHandle
        aria-label={i18n.t('Resize task terminal')}
        disabled={!terminalOpen}
        className={cn(
          'bg-border hover:bg-accent focus-visible:bg-accent h-1 shrink-0 transition-colors focus-visible:outline-none',
          !terminalOpen && 'hidden',
        )}
      />
      <Panel
        ref={terminalPanel}
        order={2}
        defaultSize={terminalOpen ? 35 : 0}
        minSize={20}
        maxSize={65}
        collapsible
        collapsedSize={0}
        onResize={(size) => {
          if (size > 0) expandedSize.current = size;
        }}
        onCollapse={() => {
          if (terminalOpen && !syncingVisibility.current) onHideTerminal();
        }}
      >
        <section
          aria-label={i18n.t('Terminal')}
          className={cn(
            'bg-surface h-full min-h-0 flex-col overflow-hidden',
            terminalOpen ? 'flex' : 'hidden',
          )}
        >
          <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
            <Terminal className="text-fg-dim h-3.5 w-3.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="text-fg shrink-0 text-[11px] font-medium">{i18n.t('Terminal')}</h2>
                <span className="text-fg-dim truncate font-mono text-[10px]" title={cwd}>
                  {cwd}
                </span>
              </div>
              <p className="text-fg-dim truncate text-[10px]">
                {i18n.t('Workspace shell · independent of the agent turn')}
              </p>
            </div>
            <button
              type="button"
              aria-label={i18n.t('Hide terminal')}
              title={i18n.t('Terminal processes stay open when you close this panel.')}
              onClick={onHideTerminal}
              className="text-fg-dim hover:bg-surface-overlay hover:text-fg focus-visible:ring-accent flex h-6 w-6 shrink-0 items-center justify-center rounded transition focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {/* Hiding the panel keeps the same terminal mounted, including its running process. */}
            {(terminalCreated || terminalOpen) && (
              <TerminalPane id={`agent-shell-${sessionId}-${viewId}`} cwd={cwd} minHeight={0} />
            )}
          </div>
        </section>
      </Panel>
    </PanelGroup>
  );
}
