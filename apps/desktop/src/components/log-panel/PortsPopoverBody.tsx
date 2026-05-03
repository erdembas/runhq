import { ExternalLink, Network } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { localUrl } from '@/lib/url';
import type { ListeningPort } from '@/types';

interface PortsPopoverBodyProps {
  pid: number | null;
  ports: ListeningPort[];
}

export function PortsPopoverBody({ pid, ports }: PortsPopoverBodyProps) {
  if (ports.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <Network className="text-fg-dim mx-auto mb-2 h-4 w-4" />
        <p className="text-fg-muted text-[12px]">No listening ports detected.</p>
        <p className="text-fg-dim mt-1 text-[10.5px]">
          Start the service{pid != null ? ` (pid ${pid})` : ''} and any listeners will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="border-border bg-surface-muted text-fg-dim flex items-center justify-between border-b px-3 py-1.5 text-[10px] tracking-wide uppercase">
        <span>Listening ports</span>
        <span className="tracking-normal normal-case tabular-nums">{ports.length} open</span>
      </div>
      <div className="divide-border max-h-[280px] divide-y overflow-auto">
        {ports.map((port) => (
          <div
            key={`${port.pid}-${port.port}`}
            className="hover:bg-surface-muted/50 group flex items-center gap-2 px-3 py-2 transition"
          >
            <span className="bg-accent/10 text-accent rounded-app-sm shrink-0 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold">
              :{port.port}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-fg truncate font-mono text-[11.5px]">{port.process_name}</p>
              <p className="text-fg-dim font-mono text-[10px]">pid {port.pid}</p>
            </div>
            <button
              type="button"
              className="text-accent hover:bg-accent/10 rounded-app-sm flex items-center gap-1 px-2 py-1 text-[11px] opacity-0 transition group-hover:opacity-100"
              onClick={() => void ipc.openUrl(localUrl(port.port))}
            >
              Open <ExternalLink className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
