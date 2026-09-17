import { Bot } from 'lucide-react';
import type { AgentBackendId } from '@runhq/cockpit-types';

const logos: Record<string, string> = {
  codex: new URL('../assets/agents/codex.svg', import.meta.url).href,
  opencode: new URL('../assets/agents/opencode.svg', import.meta.url).href,
  claude: new URL('../assets/agents/claude.svg', import.meta.url).href,
  cursor: new URL('../assets/agents/cursor.svg', import.meta.url).href,
};

/** Bundled brand marks; masks inherit the foreground in both light and dark themes. */
export function AgentProviderLogo({
  backend,
  className = 'h-4 w-4',
}: {
  backend: AgentBackendId;
  className?: string;
}) {
  if (!logos[backend]) return <Bot aria-hidden="true" className={className} />;
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${backend === 'claude' ? 'text-[#D97757]' : ''} ${className}`}
      style={{
        backgroundColor: 'currentColor',
        mask: `url("${logos[backend]}") center / contain no-repeat`,
        WebkitMask: `url("${logos[backend]}") center / contain no-repeat`,
      }}
    />
  );
}
