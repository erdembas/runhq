import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ChevronUp, Loader2 } from 'lucide-react';
import type { AgentItem } from '@runhq/cockpit-types';

interface Props {
  messages: AgentItem[];
  scrollRef: RefObject<HTMLDivElement>;
  visible: boolean;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  onNavigate: (id: string) => void;
}

export function AgentMessageNavigator({
  messages,
  scrollRef,
  visible,
  hasEarlier,
  loadingEarlier,
  onLoadEarlier,
  onNavigate,
}: Props) {
  i18n.useLocale();
  const previewId = useId();
  const root = useRef<HTMLElement>(null);
  const markers = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string>();
  const [preview, setPreview] = useState<{ id: string; top: number } | null>(null);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!visible || !viewport || !messages.length) return;
    const targets = messages.map((message) =>
      viewport.querySelector<HTMLElement>(`[data-agent-item="${CSS.escape(message.id)}"]`),
    );
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = viewport.getBoundingClientRect().top + 32;
      if (!viewport.clientHeight) return;
      let current = messages[0]?.id;
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        if (!target) continue;
        if (target.getBoundingClientRect().top > top) break;
        current = messages[index]?.id;
      }
      setActiveId(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    // Streaming replies and expanded activity can move messages without a scroll event.
    for (const child of viewport.children) observer.observe(child);
    viewport.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener('scroll', schedule);
    };
  }, [messages, scrollRef, visible]);

  useEffect(() => {
    const list = markers.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !current) return;
    const bounds = list.getBoundingClientRect();
    const target = current.getBoundingClientRect();
    if (target.top < bounds.top) list.scrollTop -= bounds.top - target.top;
    else if (target.bottom > bounds.bottom) list.scrollTop += target.bottom - bounds.bottom;
  }, [activeId, visible]);

  useEffect(() => {
    if (!preview) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null);
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [preview]);

  if (!messages.length && !hasEarlier) return null;
  const previewIndex = messages.findIndex((message) => message.id === preview?.id);
  const activeIndex = messages.findIndex((message) => message.id === activeId);
  const previewMessage = messages[previewIndex];
  const showPreview = (id: string, button: HTMLButtonElement) => {
    const bounds = root.current?.getBoundingClientRect();
    if (!bounds) return;
    setPreview({
      id,
      top: Math.max(
        0,
        Math.min(button.getBoundingClientRect().top - bounds.top - 32, bounds.height - 160),
      ),
    });
  };

  return (
    <nav
      ref={root}
      aria-label={i18n.t('Your messages')}
      className="pointer-events-none absolute inset-y-4 left-0 z-10 flex w-9 flex-col justify-center"
      onMouseLeave={() => setPreview(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null);
      }}
      onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(
          markers.current?.querySelectorAll('button:not(:disabled)') ?? [],
        );
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : index + (event.key === 'ArrowDown' ? 1 : -1);
        (buttons[Math.max(0, Math.min(next, buttons.length - 1))] as HTMLButtonElement)?.focus();
      }}
    >
      <div
        ref={markers}
        className="pointer-events-auto flex max-h-[70%] [scrollbar-width:none] flex-col items-center overflow-y-auto overscroll-contain py-1 [&::-webkit-scrollbar]:hidden"
        onScroll={() => setPreview(null)}
      >
        {hasEarlier && (
          <button
            type="button"
            disabled={loadingEarlier}
            aria-label={
              loadingEarlier ? i18n.t('Loading earlier messages…') : i18n.t('Load earlier messages')
            }
            title={
              loadingEarlier ? i18n.t('Loading earlier messages…') : i18n.t('Load earlier messages')
            }
            onClick={onLoadEarlier}
            className="text-fg-dim hover:text-fg focus-visible:ring-accent/50 mb-1 flex h-6 w-7 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-50"
          >
            {loadingEarlier ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <ChevronUp className="h-3 w-3" aria-hidden />
            )}
          </button>
        )}
        {messages.map((message, index) => (
          <button
            key={message.id}
            type="button"
            tabIndex={message.id === (activeId ?? messages[0]?.id) ? 0 : -1}
            aria-current={message.id === activeId ? 'location' : undefined}
            aria-label={i18n.t('Jump to message: {message}', {
              message: (message.text || message.title).slice(0, 160),
            })}
            aria-describedby={preview?.id === message.id ? previewId : undefined}
            onMouseEnter={(event) => showPreview(message.id, event.currentTarget)}
            onFocus={(event) => showPreview(message.id, event.currentTarget)}
            onClick={() => {
              setPreview(null);
              onNavigate(message.id);
            }}
            className="group/marker focus-visible:ring-accent/50 flex h-4 w-7 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-inset"
          >
            <span
              aria-hidden
              className={`group-hover/marker:bg-fg h-0.5 rounded-full transition-[width,background-color] group-hover/marker:w-4 group-focus-visible/marker:w-4 motion-reduce:transition-none ${message.id === activeId ? 'bg-fg w-3.5' : index < activeIndex ? 'bg-fg/35 w-2' : 'bg-fg/15 w-2'}`}
            />
          </button>
        ))}
      </div>
      {preview && previewMessage && (
        <div
          className="pointer-events-auto absolute left-8 pl-2"
          style={{
            top: preview.top,
            width: Math.min(336, (scrollRef.current?.clientWidth ?? 360) - 48),
          }}
        >
          <div
            id={previewId}
            role="tooltip"
            className="border-border bg-surface-overlay text-fg rounded-lg border px-3 py-2.5 shadow-xl"
          >
            <div className="text-fg-dim mb-1.5 text-[10px]">
              {i18n.t('Message {number}', { number: i18n.number(previewIndex + 1) })}
            </div>
            <p className="line-clamp-5 text-[12px] leading-5 break-words whitespace-pre-wrap">
              {previewMessage.text || previewMessage.title}
            </p>
          </div>
        </div>
      )}
    </nav>
  );
}
