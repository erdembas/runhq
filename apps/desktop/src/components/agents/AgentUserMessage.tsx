import * as i18n from '@runhq/cockpit-ui/i18n';
import { ChevronRight, MessageSquareText, ShieldCheck, ShieldX } from 'lucide-react';
import type { AgentItem } from '@runhq/cockpit-types';
import { describeAgentResponse } from './agentResponse';
import { AgentMessageCopyButton } from './AgentMessageCopyButton';

export function AgentUserMessage({ item, request }: { item: AgentItem; request?: AgentItem }) {
  i18n.useLocale();
  const response = describeAgentResponse(item, request);
  if (!response)
    return (
      <article className="bg-fg/5 text-fg ml-6 rounded-lg px-4 py-3 text-[13px] break-words whitespace-pre-wrap">
        <div className="text-fg-dim mb-1 text-[11px]">{item.title}</div>
        <div>{item.text}</div>
        <AgentMessageCopyButton text={item.text} />
      </article>
    );

  const Icon =
    response.tone === 'allowed'
      ? ShieldCheck
      : response.tone === 'declined'
        ? ShieldX
        : MessageSquareText;
  const tone =
    response.tone === 'allowed'
      ? 'bg-tone-success/10 text-tone-success-fg'
      : response.tone === 'declined'
        ? 'bg-tone-critical/10 text-tone-critical-fg'
        : 'bg-fg/5 text-fg-muted';

  return (
    <article className="border-border/60 bg-fg/2 ml-6 max-w-2xl overflow-hidden rounded-xl border">
      <details className="group/response">
        <summary className="hover:bg-fg/3 focus-visible:ring-accent/50 cursor-pointer list-none rounded-xl px-3.5 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2.5">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-fg block text-[12px] font-medium">{response.label}</span>
              {request?.title && (
                <span className="text-fg-muted mt-0.5 block text-[11px] break-words">
                  {request.title}
                </span>
              )}
            </span>
            <span className="text-fg-dim hidden shrink-0 text-[10px] sm:inline">
              {i18n.t('Your response')}
            </span>
            <ChevronRight
              className="text-fg-dim h-3.5 w-3.5 shrink-0 transition-transform group-open/response:rotate-90"
              aria-hidden
            />
            <span className="sr-only">{i18n.t('Response details')}</span>
          </span>
          {response.fields.length > 0 && (
            <span className="mt-3 block space-y-3 pl-9.5">
              {response.fields.map((field, index) => (
                <span key={index} className="block min-w-0">
                  <span className="text-fg-muted mb-1.5 block text-[11px] break-words">
                    {field.label}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {field.values.length > 0 ? (
                      field.values.map((value, valueIndex) => (
                        <span
                          key={valueIndex}
                          className="bg-fg/5 text-fg min-w-0 rounded-md px-2 py-1 text-[12px] break-words whitespace-pre-wrap"
                        >
                          {value}
                        </span>
                      ))
                    ) : (
                      <span className="text-fg-dim text-[12px]">{i18n.t('No answer')}</span>
                    )}
                  </span>
                </span>
              ))}
            </span>
          )}
        </summary>
        <div className="border-border/60 border-t px-3.5 py-3">
          <p className="text-fg-dim mb-2 text-[10px]">{i18n.t('Response details')}</p>
          <pre className="text-fg-muted max-h-64 overflow-auto font-mono text-[11px] break-words whitespace-pre-wrap">
            {item.text}
          </pre>
        </div>
      </details>
      <div className="px-3.5 pb-2">
        <AgentMessageCopyButton text={item.text} />
      </div>
    </article>
  );
}
