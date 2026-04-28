import type { CategoryKey } from '@/lib/categories';
import type { ServiceDef, ServiceId, StackDef, Status } from '@/types';

export type FilterMode = 'all' | 'running' | 'stopped' | CategoryKey;

export interface ServiceCmd {
  name: string;
  cmd: string;
  status: Status;
}

export type ListItem =
  | {
      type: 'app-action';
      id: string;
      label: string;
      subtitle: string;
      shortcut: string;
      icon: React.ReactNode;
      run: () => Promise<void>;
    }
  | { type: 'header'; label: string }
  | { type: 'service'; service: ServiceDef; cmds: ServiceCmd[] }
  | { type: 'expanded-header'; service: ServiceDef; cmds: ServiceCmd[] }
  | {
      type: 'sub-action';
      serviceId: ServiceId;
      label: string;
      subtitle?: string;
      icon: React.ReactNode;
      danger?: boolean;
      /**
       * Marks this row as a child of an inline-expandable parent (the
       * "Open in IDE…" expansion). Renderer applies a deeper indent and
       * a faint guide line so the parent–child relationship reads at a
       * glance instead of forcing the user to count whitespace.
       */
      nested?: boolean;
      /**
       * Indicates the row toggles an inline expansion rather than
       * committing an action. Renderer flips the chevron and the
       * keyboard handler can wire `→` to "expand" if needed.
       */
      expandable?: boolean;
      /** Current expansion state for `expandable` rows. */
      expanded?: boolean;
      /**
       * Stable key used by the per-service usage tracker (`actionStats`)
       * to rank rows in the "Frequent" section. Omitted on rows that
       * shouldn't be tracked — e.g. expander parents like "Open in IDE"
       * which only toggle UI state and never commit anything.
       */
      actionKey?: string;
      run: () => Promise<void>;
    }
  | { type: 'cmd-header' }
  | { type: 'expanded-cmd'; serviceId: ServiceId; cmd: ServiceCmd }
  | {
      type: 'cmd';
      serviceId: ServiceId;
      serviceName: string;
      cmdName: string;
      cmd: string;
      status: Status;
    }
  | { type: 'stack'; stack: StackDef; runningCount: number }
  | {
      type: 'expanded-stack';
      stack: StackDef;
      services: ServiceDef[];
      cmdsPerService: Record<ServiceId, ServiceCmd[]>;
    }
  | {
      type: 'stack-action';
      stackId: string;
      label: string;
      icon: React.ReactNode;
      danger?: boolean;
      run: () => Promise<void>;
    };

export function isRunning(s: Status | undefined) {
  return s === 'running' || s === 'starting';
}

export function isSelectable(item: ListItem | undefined) {
  return !!item && item.type !== 'header' && item.type !== 'cmd-header';
}
