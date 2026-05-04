import type { CommandStatus, ServiceDef } from '@/types';
import { CommandRunItem } from './CommandRunItem';

interface CommandRunStripProps {
  activeCmd: string | null;
  cmdStatuses: CommandStatus[];
  onSelect: (commandName: string) => void;
  service: ServiceDef;
}

export function CommandRunStrip({
  activeCmd,
  cmdStatuses,
  onSelect,
  service,
}: CommandRunStripProps) {
  if (service.cmds.length <= 1) return null;

  return (
    <div className="scrollbar-none flex max-w-[48vw] min-w-0 items-center gap-1 overflow-x-auto">
      {service.cmds.map((entry) => {
        const commandStatus = cmdStatuses.find((command) => command.name === entry.name);
        return (
          <CommandRunItem
            key={entry.name}
            active={activeCmd === entry.name}
            command={entry}
            serviceId={service.id}
            status={commandStatus}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}
