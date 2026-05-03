import {
  Check,
  FileSearch,
  GitBranch,
  Globe,
  Inbox,
  ListChecks,
  MessageSquare,
  Pin,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export function OriginIcon({ origin, pinned }: { origin: string; pinned: boolean }) {
  let icon: React.ReactNode;
  switch (origin) {
    case 'why':
      icon = <FileSearch className="h-3 w-3" />;
      break;
    case 'log':
      icon = <Inbox className="h-3 w-3" />;
      break;
    case 'diff':
      icon = <GitBranch className="h-3 w-3" />;
      break;
    case 'commit':
      icon = <Check className="h-3 w-3" />;
      break;
    case 'standup':
      icon = <ListChecks className="h-3 w-3" />;
      break;
    case 'dashboard_report':
      icon = <Globe className="h-3 w-3" />;
      break;
    case 'advisory':
      icon = <Sparkles className="h-3 w-3" />;
      break;
    case 'free':
    default:
      icon = <MessageSquare className="h-3 w-3" />;
      break;
  }
  return (
    <span
      className={cn(
        'relative flex h-5 w-5 items-center justify-center rounded',
        'bg-fg/8 text-fg-dim',
      )}
    >
      {icon}
      {pinned && (
        <Pin className="text-accent absolute -top-0.5 -right-0.5 h-2 w-2" fill="currentColor" />
      )}
    </span>
  );
}
