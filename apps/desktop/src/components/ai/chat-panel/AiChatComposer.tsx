import type { Ref, RefObject } from 'react';
import { ArrowUp, ChevronDown, CornerDownLeft, Settings, Sparkles, Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { AiProvider, ServiceDef } from '@/types';
import { ModelPicker } from '../ModelPicker';
import { TokenMeter } from '../TokenMeter';

interface Props {
  awaitingAutoSend: boolean;
  contextChips: Array<{ id: string; label: string }>;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isInline: boolean;
  isStreaming: boolean;
  pickerOpen: boolean;
  pickerRef: RefObject<HTMLDivElement | null>;
  provider: AiProvider | null;
  providers: AiProvider[];
  selectedService: ServiceDef | null;
  tokenCount: number | null;
  turnsLength: number;
  onCancel: () => void;
  onInput: (value: string) => void;
  onManageModels: () => void;
  onPickerOpenChange: (open: boolean) => void;
  onSelectProvider: (provider: AiProvider) => void;
  onSend: () => void;
}

export function AiChatComposer(props: Props) {
  return (
    <>
      {props.contextChips.length > 0 && <ContextChips chips={props.contextChips} />}
      <div className="px-3 pb-3">
        <div
          className={cn(
            'rounded-app bg-fg/3 cursor-text border',
            'border-border/40 focus-within:border-border/80 focus-within:bg-fg/5',
            'shadow-[inset_0_1px_0_rgb(255_255_255/0.02)] transition-colors',
          )}
          onClick={(e) => {
            if (e.target === e.currentTarget) props.inputRef.current?.focus();
          }}
        >
          <textarea
            ref={props.inputRef as Ref<HTMLTextAreaElement>}
            value={props.input}
            onChange={(e) => props.onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!props.isStreaming) props.onSend();
              }
            }}
            placeholder={
              props.selectedService
                ? `Ask about ${props.selectedService.name}, your logs, or anything else…`
                : 'Ask anything about your projects, diffs, or logs…'
            }
            rows={1}
            className={cn(
              'block w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1.5',
              'text-fg placeholder:text-fg/35 text-[13px] leading-snug',
              'outline-none focus:ring-0 focus:outline-none focus-visible:ring-0! focus-visible:outline-none!',
              'max-h-[180px] min-h-[24px]',
            )}
          />
          <div className="flex items-center gap-1 px-1.5 pt-1 pb-1.5">
            <ModelControl {...props} />
            <span className="flex-1" />
            {(props.tokenCount == null || props.tokenCount > 0) && (
              <TokenMeter
                count={props.tokenCount}
                contextWindow={props.provider?.context_window ?? null}
                className="mr-1.5"
              />
            )}
            {props.isStreaming ? (
              <button
                type="button"
                onClick={props.onCancel}
                title="Stop (Esc)"
                aria-label="Stop generating"
                className="bg-fg/10 hover:bg-fg/20 text-fg/90 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              >
                <Square className="h-3 w-3" fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={props.onSend}
                disabled={!props.input.trim() || !props.provider}
                title="Send · Enter"
                aria-label="Send message"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md transition-all',
                  'bg-accent text-accent-fg hover:bg-accent-hover',
                  'disabled:bg-fg/10 disabled:text-fg-dim/70 disabled:cursor-not-allowed',
                )}
              >
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
        {props.input.length === 0 && props.turnsLength === 0 && !props.isStreaming && (
          <div className="text-fg-dim/60 mt-1.5 flex items-center gap-1.5 px-1 text-[10px]">
            <CornerDownLeft className="h-2.5 w-2.5" />
            <span>
              Enter to send · Shift+Enter for newline{!props.isInline ? ' · Esc to close' : ''}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function ModelControl(props: Props) {
  if (!props.provider) {
    return (
      <button
        type="button"
        onClick={props.onManageModels}
        tabIndex={-1}
        className="text-fg-dim hover:text-fg hover:bg-fg/5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors"
      >
        <Settings className="h-3 w-3" />
        <span>Configure model…</span>
      </button>
    );
  }

  return (
    <div ref={props.pickerRef as Ref<HTMLDivElement>} className="relative">
      <button
        type="button"
        onClick={() => props.onPickerOpenChange(!props.pickerOpen)}
        title={`${props.provider.name} · ${props.provider.model || 'no model'}`}
        aria-haspopup="listbox"
        aria-expanded={props.pickerOpen}
        tabIndex={-1}
        className={cn(
          'group text-fg-dim hover:text-fg hover:bg-fg/5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
          props.pickerOpen && 'text-fg bg-fg/5',
        )}
      >
        <Sparkles className="text-accent/70 h-3 w-3" />
        <span className="max-w-[180px] truncate">
          {props.provider.model || props.provider.name}
        </span>
        <ChevronDown
          className={cn(
            'h-2.5 w-2.5 opacity-50 transition-all group-hover:opacity-90',
            props.pickerOpen && 'rotate-180 opacity-90',
          )}
        />
      </button>
      {props.pickerOpen && (
        <ModelPicker
          providers={props.providers}
          activeId={props.provider.id}
          onSelect={props.onSelectProvider}
          onManage={props.onManageModels}
          awaitingAutoSend={props.awaitingAutoSend}
        />
      )}
    </div>
  );
}

function ContextChips({ chips }: { chips: Array<{ id: string; label: string }> }) {
  return (
    <div className="border-border/60 flex flex-wrap gap-1 border-t px-3 pt-2 pb-1">
      <span className="text-fg-dim text-[9px] font-semibold tracking-[0.12em] uppercase">
        Context
      </span>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="bg-accent/10 text-accent rounded px-1.5 py-0.5 font-mono text-[10px]"
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}
