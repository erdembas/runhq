'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function AgentComposer({
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
  busy,
  compact = false,
  controls,
  action,
  children,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  controls: ReactNode;
  action: ReactNode;
  children?: ReactNode;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    const fit = () => {
      // A project tab can stay mounted while hidden. Measure it when it becomes visible.
      if (!element.clientWidth) return;
      const scrollTop = element.scrollTop;
      element.style.height = '0px';
      const minimum = compact ? 64 : 112;
      const limit = Math.max(minimum, Math.min(240, window.innerHeight * 0.28));
      element.style.height = `${Math.max(minimum, Math.min(element.scrollHeight, limit))}px`;
      element.style.overflowY = element.scrollHeight > limit ? 'auto' : 'hidden';
      element.scrollTop = scrollTop;
    };
    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fit();
    });
    observer.observe(element);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [value, compact]);

  return (
    <div className="bg-surface-raised border-fg/8 focus-within:border-fg/18 rounded-[20px] border shadow-[0_8px_28px_rgb(0_0_0/0.06)] transition-colors duration-200">
      <div className="px-1 pt-1">
        <textarea
          ref={textarea}
          aria-label="Message to agent"
          rows={3}
          style={{ outline: 'none', boxShadow: 'none', borderRadius: 0 }}
          className="text-fg placeholder:text-fg-dim/80 block w-full resize-none border-0 bg-transparent px-4 pt-4 pb-3 text-[14px] leading-6 disabled:opacity-60"
          maxLength={200000}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled || busy}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              !disabled &&
              !busy
            ) {
              event.preventDefault();
              onSend();
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 px-3 pt-1 pb-3">
        {controls}
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </div>
      {children}
    </div>
  );
}
