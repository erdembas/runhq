import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

export function AgentMessageCopyButton({ text }: { text: string }) {
  i18n.useLocale();
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await writeText(text);
      setStatus('copied');
      timer.current = window.setTimeout(() => setStatus('idle'), 1800);
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="mt-2 flex items-center justify-end gap-2 whitespace-normal">
      {status === 'error' && (
        <span role="alert" className="text-status-error text-[11px]">
          {i18n.t('Could not copy message. Try again.')}
        </span>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={i18n.t('Copy message')}
        title={i18n.t('Copy message')}
        className="text-fg-dim hover:bg-fg/5 hover:text-fg focus-visible:ring-accent/50 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] outline-none focus-visible:ring-2"
      >
        {status === 'copied' ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
        <span role="status">{status === 'copied' ? i18n.t('Copied') : i18n.t('Copy')}</span>
      </button>
    </div>
  );
}
