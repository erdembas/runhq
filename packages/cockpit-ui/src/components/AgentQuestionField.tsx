'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { Check, LockKeyhole, PenLine, X } from 'lucide-react';
import type { AgentQuestion } from '@runhq/cockpit-types';
import { cn } from '../lib/cn';

export function AgentQuestionField({
  question,
  id,
  selected,
  custom,
  writing,
  disabled,
  invalid,
  titleRef,
  onSelect,
  onCustom,
  onWriting,
}: {
  question: AgentQuestion;
  id: string;
  selected: string[];
  custom: string;
  writing: boolean;
  disabled: boolean;
  invalid: boolean;
  titleRef: RefObject<React.ElementRef<'legend'>>;
  onSelect: (value: string, checked: boolean) => void;
  onCustom: (value: string) => void;
  onWriting: (writing: boolean) => void;
}) {
  const hasOptions = question.options.length > 0;
  const canWrite = question.allow_custom !== false;
  const textRef = useRef<HTMLTextAreaElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    (writing
      ? question.secret
        ? secretRef.current
        : textRef.current
      : toggleRef.current
    )?.focus();
    moveFocus.current = false;
  }, [writing, question.secret]);
  const toggleWriting = (next: boolean) => {
    moveFocus.current = true;
    onWriting(next);
  };
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={invalid ? `${id}-error` : undefined}
      className="min-w-0 space-y-4"
    >
      <legend
        ref={titleRef}
        tabIndex={-1}
        className="text-fg mb-2 w-full text-[15px] leading-relaxed font-medium outline-none"
      >
        {question.question}
      </legend>
      {hasOptions && (
        <>
          <p className="text-fg-dim text-[11px]">
            {question.multiple ? 'Select all that apply' : 'Choose one option'}
            {canWrite ? (question.multiple ? ', or add your own.' : ', or write your own.') : '.'}
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-2">
            {question.options.map((option) => {
              const value = option.value ?? option.label;
              const checked = selected.includes(value) && (question.multiple || !writing);
              return (
                <label
                  key={value}
                  className={cn(
                    'group relative flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                    'has-focus-visible:ring-accent/35 has-focus-visible:ring-2',
                    checked
                      ? 'border-fg/25 bg-fg/5'
                      : 'border-border/70 hover:border-fg/20 hover:bg-fg/3',
                    disabled && 'pointer-events-none opacity-50',
                  )}
                >
                  <input
                    className="sr-only"
                    type={question.multiple ? 'checkbox' : 'radio'}
                    name={id}
                    checked={checked}
                    onChange={(event) => onSelect(value, event.target.checked)}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border',
                      question.multiple ? 'rounded' : 'rounded-full',
                      checked ? 'border-accent bg-accent text-accent-fg' : 'border-fg/25',
                    )}
                  >
                    {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-fg block text-[12px] font-medium break-words">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="text-fg-muted mt-1 block text-[11px] leading-relaxed break-words">
                        {option.description}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </>
      )}
      {canWrite &&
        (writing || !hasOptions ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor={`${id}-custom`}
                className="text-fg-muted flex flex-1 items-center gap-1.5 text-[11px] font-medium"
              >
                {question.secret ? (
                  <LockKeyhole className="h-3 w-3" />
                ) : (
                  <PenLine className="h-3 w-3" />
                )}
                {question.multiple && hasOptions ? 'Your additional answer' : 'Your answer'}
              </label>
              {hasOptions && (
                <button
                  type="button"
                  aria-label="Use only the listed options"
                  title="Use only the listed options"
                  onClick={() => toggleWriting(false)}
                  className="text-fg-dim hover:bg-fg/5 hover:text-fg rounded p-1 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {question.secret ? (
              <input
                ref={secretRef}
                id={`${id}-custom`}
                type="password"
                autoComplete="off"
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${id}-error` : undefined}
                value={custom}
                onChange={(event) => onCustom(event.target.value)}
                className="border-border bg-surface text-fg placeholder:text-fg-dim focus:border-fg/30 focus:ring-fg/5 w-full rounded-xl border px-3.5 py-3 text-[13px] outline-none focus:ring-4 disabled:opacity-50"
                placeholder="Enter your answer…"
              />
            ) : (
              <textarea
                ref={textRef}
                id={`${id}-custom`}
                rows={3}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${id}-error` : undefined}
                value={custom}
                onChange={(event) => onCustom(event.target.value)}
                className="border-border bg-surface text-fg placeholder:text-fg-dim focus:border-fg/30 focus:ring-fg/5 max-h-64 min-h-24 w-full resize-y rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed outline-none focus:ring-4 disabled:opacity-50"
                placeholder={
                  question.multiple && hasOptions ? 'Add any other details…' : 'Write your answer…'
                }
              />
            )}
          </div>
        ) : (
          <button
            ref={toggleRef}
            type="button"
            onClick={() => toggleWriting(true)}
            className="text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-accent/35 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] outline-none focus-visible:ring-2"
          >
            <PenLine className="h-3.5 w-3.5" />
            {question.multiple ? 'Add your own answer' : 'Write your own answer'}
          </button>
        ))}
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-status-error text-[12px]">
          {!hasOptions
            ? 'Write an answer to continue.'
            : canWrite
              ? 'Choose an option or write an answer to continue.'
              : 'Choose an option to continue.'}
        </p>
      )}
    </fieldset>
  );
}
