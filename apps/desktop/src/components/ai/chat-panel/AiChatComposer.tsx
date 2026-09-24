import * as i18n from '@runhq/cockpit-ui/i18n';
import { matchesMessageSendShortcut } from '@runhq/cockpit-ui';
import type { AiChatProvider } from './aiChatProviders';
import type { Ref, RefObject } from 'react';
import {
  ArrowUp,
  ChevronDown,
  CornerDownLeft,
  Sparkles,
  Square,
  TerminalSquare,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMessageSendShortcut } from '@/lib/useMessageSendShortcut';
import type { ServiceDef } from '@/types';
import { ModelPicker } from '../ModelPicker';
import { TokenMeter } from '../TokenMeter';
import { isCliChatProvider } from './aiChatProviders';
import type { ReactNode } from 'react';

interface Props {
  awaitingAutoSend: boolean;
  contextChips: Array<{ id: string; label: string }>;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isInline: boolean;
  isStreaming: boolean;
  pickerOpen: boolean;
  pickerRef: RefObject<HTMLDivElement | null>;
  provider: AiChatProvider | null;
  providers: AiChatProvider[];
  selectedService: ServiceDef | null;
  tokenCount: number | null;
  turnsLength: number;
  projectControl?: ReactNode;
  providerControls?: ReactNode;
  onCancel: () => void;
  onInput: (value: string) => void;
  onManageModels: () => void;
  onPickerOpenChange: (open: boolean) => void;
  onSelectProvider: (provider: AiChatProvider) => void;
  onSend: () => void;
}

export function AiChatComposer(props: Props) {
  i18n.useLocale();
  const { sendShortcut, title, hint } = useMessageSendShortcut();
  return (
    <>
      {props.contextChips.length > 0 && <ContextChips chips={props.contextChips} />}
      <div className="px-3 pb-3">
        {props.projectControl}
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
              if (matchesMessageSendShortcut(e.nativeEvent, sendShortcut)) {
                e.preventDefault();
                if (
                  !e.repeat &&
                  !props.isStreaming &&
                  !props.awaitingAutoSend &&
                  props.provider &&
                  props.input.trim()
                ) {
                  props.onSend();
                }
              }
            }}
            placeholder={
              props.selectedService
                ? i18n.t('Ask about {value1}, your logs, or anything else…', {
                    value1: props.selectedService.name,
                  })
                : i18n.t('Ask anything about your projects, diffs, or logs…')
            }
            rows={1}
            className={cn(
              'block w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1.5',
              'text-fg placeholder:text-fg/35 text-[13px] leading-snug',
              'outline-none focus:ring-0 focus:outline-none focus-visible:ring-0! focus-visible:outline-none!',
              'max-h-[180px] min-h-[24px]',
            )}
          />
          {props.providerControls && (
            <div className="border-border/30 border-t px-2 py-1">{props.providerControls}</div>
          )}
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
                title={i18n.t('Stop (Esc)')}
                aria-label={i18n.t('Stop generating')}
                className="bg-fg/10 hover:bg-fg/20 text-fg/90 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              >
                <Square className="h-3 w-3" fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={props.onSend}
                disabled={props.awaitingAutoSend || !props.input.trim() || !props.provider}
                title={title}
                aria-label={i18n.t('Send message')}
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
            <span>{hint}</span>
            {!props.isInline && <span>{i18n.t(' · Esc to close')}</span>}
          </div>
        )}
      </div>
    </>
  );
}

function ModelControl(props: Props) {
  i18n.useLocale();
  const cli = props.provider && isCliChatProvider(props.provider);
  const Icon = cli ? TerminalSquare : Sparkles;
  return (
    <div ref={props.pickerRef as Ref<HTMLDivElement>} className="relative">
      <button
        type="button"
        onClick={() => props.onPickerOpenChange(!props.pickerOpen)}
        title={
          props.provider
            ? `${props.provider.name} · ${props.provider.model || (cli ? i18n.t('CLI default model') : '')}`
            : i18n.t('Choose a CLI tool or API provider')
        }
        aria-haspopup="listbox"
        aria-expanded={props.pickerOpen}
        className={cn(
          'group text-fg-dim hover:text-fg hover:bg-fg/5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
          props.pickerOpen && 'text-fg bg-fg/5',
        )}
      >
        <Icon className="h-3 w-3" />
        <span className="max-w-[180px] truncate">
          {props.provider?.model || props.provider?.name || i18n.t('Choose provider')}
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
          providers={props.providers.map((entry) =>
            entry.id === props.provider?.id ? props.provider : entry,
          )}
          activeId={props.provider?.id ?? null}
          onSelect={props.onSelectProvider}
          onManage={props.onManageModels}
          awaitingAutoSend={props.awaitingAutoSend}
        />
      )}
    </div>
  );
}

function ContextChips({ chips }: { chips: Array<{ id: string; label: string }> }) {
  i18n.useLocale();
  return (
    <div className="border-border/60 flex flex-wrap gap-1 border-t px-3 pt-2 pb-1">
      <span className="text-fg-dim text-[9px] font-semibold tracking-[0.12em] uppercase">
        {i18n.t('Context')}
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
