'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { SearchableSelect } from './SearchableSelect';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  MessageSquareText,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { AgentRequest } from '@runhq/cockpit-types';
import { collectAgentRequestAnswers } from '../lib/agentRequestAnswers';
import { cn } from '../lib/cn';
import { AgentQuestionField } from './AgentQuestionField';

const field =
  'bg-surface border-border text-fg focus:border-fg/30 focus:ring-fg/5 w-full rounded-xl border px-3.5 py-2.5 text-[13px] outline-none focus:ring-4 disabled:opacity-50';
const button =
  'border-border text-fg hover:bg-fg/5 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-40 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2';
const primaryButton =
  'bg-accent text-accent-fg hover:bg-accent-hover focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40 inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2';

export function AgentRequestCard({
  request,
  onAnswer,
  onOpenUrl,
  disabled = false,
}: {
  request: AgentRequest;
  onAnswer: (value: unknown) => Promise<void>;
  disabled?: boolean;
  onOpenUrl?: (url: string) => Promise<void>;
}) {
  const cardId = useId();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState(0);
  const [invalidId, setInvalidId] = useState<string | null>(null);
  const questionTitle = useRef<React.ElementRef<'legend'>>(null);
  const focusQuestion = useRef(false);
  const sending = useRef(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [raw, setRaw] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const locked = disabled || busy || sent;
  const questions = request.questions ?? [];
  const currentIndex = Math.min(step, Math.max(0, questions.length - 1));
  const question = questions[currentIndex];
  const isWriting = (id: string) => {
    const target = questions.find((q) => q.id === id);
    return target?.allow_custom !== false && (writing[id] ?? (target?.options.length ?? 0) <= 1);
  };
  const effectiveSelected = Object.fromEntries(
    questions.map((q) => [
      q.id,
      !q.multiple && q.allow_custom !== false && isWriting(q.id) ? [] : (answers[q.id] ?? []),
    ]),
  );
  const effectiveCustom = Object.fromEntries(
    questions.map((q) => [q.id, isWriting(q.id) ? (custom[q.id] ?? '') : '']),
  );
  const collected = collectAgentRequestAnswers(questions, effectiveSelected, effectiveCustom);
  const properties = request.schema?.properties as
    | Record<
        string,
        {
          type?: string;
          title?: string;
          description?: string;
          enum?: string[];
          default?: unknown;
          minimum?: number;
          maximum?: number;
        }
      >
    | undefined;
  const simpleForm =
    properties &&
    Object.values(properties).every(
      (p) =>
        ['string', 'boolean', 'number', 'integer'].includes(p.type ?? 'string') &&
        (!p.enum || p.enum.every((v) => typeof v === 'string')),
    );
  const required = (request.schema?.required ?? []) as string[];
  useEffect(() => {
    if (focusQuestion.current) {
      questionTitle.current?.focus();
      focusQuestion.current = false;
    }
  }, [currentIndex]);
  const goTo = (index: number) => {
    if (locked) return;
    focusQuestion.current = true;
    setStep(index);
    setInvalidId(null);
    setError(null);
  };
  const send = async (value: unknown) => {
    if (locked || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onAnswer(value);
      setSent(true);
    } catch (e) {
      setError(String(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const questionSubmit = () => {
    if (locked) return;
    if (!question) {
      void send({ answers: collected.answers });
      return;
    }
    if (collected.missingQuestionIds.includes(question.id)) {
      setInvalidId(question.id);
      return;
    }
    if (currentIndex < questions.length - 1) {
      goTo(currentIndex + 1);
      return;
    }
    const missing = collected.missingQuestionIds[0];
    if (missing) {
      goTo(questions.findIndex((q) => q.id === missing));
      setInvalidId(missing);
      return;
    }
    void send({ answers: collected.answers });
  };
  const formSubmit = () => {
    if (locked) return;
    try {
      const content = request.url
        ? undefined
        : simpleForm
          ? Object.fromEntries(
              Object.entries(properties)
                .map(([key, schema]) => [key, form[key] ?? schema.default])
                .filter(([, value]) => value !== undefined),
            )
          : (JSON.parse(raw) as unknown);
      if (!request.url && (!content || typeof content !== 'object' || Array.isArray(content)))
        throw new Error('Response must be a JSON object.');
      if (
        simpleForm &&
        !request.url &&
        required.some(
          (key) =>
            (content as Record<string, unknown>)[key] === undefined ||
            (content as Record<string, unknown>)[key] === '',
        )
      )
        throw new Error('Complete the required fields.');
      void send(request.url ? { action: 'accept' } : { action: 'accept', content });
    } catch (e) {
      setError(String(e));
    }
  };
  if (sent)
    return (
      <section
        aria-label={request.title}
        className="border-border/70 bg-surface-raised flex w-full max-w-3xl items-center gap-3 rounded-2xl border px-5 py-4"
      >
        <span className="bg-fg/5 text-status-running flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <Check className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-fg text-[12px] font-medium" role="status">
            Response sent
          </p>
          <p className="text-fg-dim mt-0.5 truncate text-[11px]">{request.title}</p>
        </div>
      </section>
    );
  return (
    <section
      className="border-border/80 bg-surface-raised w-full max-w-3xl min-w-0 overflow-hidden rounded-2xl border shadow-sm"
      aria-labelledby={`${cardId}-title`}
      aria-busy={busy}
    >
      <header className="flex items-center gap-3 px-5 pt-4 pb-3">
        <span className="bg-fg/5 text-fg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
          {request.kind === 'approval' ? (
            <ShieldCheck className="h-4 w-4" />
          ) : (
            <MessageSquareText className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-fg-dim mb-0.5 text-[10px] font-medium tracking-wider uppercase">
            {request.kind === 'approval' ? 'Permission request' : 'Your input'}
          </p>
          <h3 id={`${cardId}-title`} className="text-fg text-[12px] font-medium break-words">
            {request.title}
          </h3>
        </div>
        {request.kind === 'question' && questions.length > 1 && (
          <span className="text-fg-dim shrink-0 text-[11px] tabular-nums" aria-live="polite">
            {collected.answeredCount} / {questions.length} answered
          </span>
        )}
      </header>
      {request.kind === 'question' && questions.length > 1 && (
        <nav
          aria-label="Questions"
          className="border-border/60 mx-5 flex flex-wrap items-center gap-1.5 border-b pb-3"
        >
          {questions.map((q, index) => {
            const answered = !collected.missingQuestionIds.includes(q.id);
            return (
              <button
                key={q.id}
                type="button"
                disabled={locked}
                aria-current={index === currentIndex ? 'step' : undefined}
                aria-label={`Question ${index + 1}: ${q.question}${answered ? ' (answered)' : ''}`}
                title={q.question}
                onClick={() => goTo(index)}
                className={cn(
                  'focus-visible:ring-accent/35 flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] transition-colors outline-none focus-visible:ring-2 disabled:opacity-40',
                  index === currentIndex
                    ? 'bg-fg/8 text-fg font-medium'
                    : 'text-fg-dim hover:bg-fg/5 hover:text-fg',
                )}
              >
                {answered ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                )}
                {index === currentIndex && <span>Question {index + 1}</span>}
              </button>
            );
          })}
        </nav>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (request.kind === 'question') questionSubmit();
          else if (request.kind === 'form') formSubmit();
        }}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === 'Enter' &&
            request.kind !== 'approval' &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
      >
        <div className="space-y-4 px-5 py-4">
          {request.details && (
            <details className="group text-fg-muted text-[12px]" open={request.kind === 'approval'}>
              <summary className="hover:text-fg flex w-fit cursor-pointer items-center gap-1.5 text-[11px] outline-none focus-visible:underline">
                <ChevronDown className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-0" />
                Request details
              </summary>
              <pre className="border-border/60 bg-surface mt-2 max-h-56 overflow-auto rounded-xl border p-3 text-[11px] leading-relaxed break-words whitespace-pre-wrap">
                {request.details}
              </pre>
            </details>
          )}
          {request.kind === 'question' && question && (
            <AgentQuestionField
              key={question.id}
              question={question}
              id={`${cardId}-${currentIndex}`}
              titleRef={questionTitle}
              selected={answers[question.id] ?? []}
              custom={custom[question.id] ?? ''}
              writing={isWriting(question.id)}
              disabled={locked}
              invalid={invalidId === question.id}
              onSelect={(value, checked) => {
                setAnswers((previous) => ({
                  ...previous,
                  [question.id]: question.multiple
                    ? checked
                      ? [...new Set([...(previous[question.id] ?? []), value])]
                      : (previous[question.id] ?? []).filter((v) => v !== value)
                    : [value],
                }));
                if (!question.multiple)
                  setWriting((previous) => ({ ...previous, [question.id]: false }));
                setInvalidId(null);
                setError(null);
              }}
              onCustom={(value) => {
                setCustom((previous) => ({ ...previous, [question.id]: value }));
                setInvalidId(null);
                setError(null);
              }}
              onWriting={(value) => {
                setWriting((previous) => ({ ...previous, [question.id]: value }));
                setInvalidId(null);
              }}
            />
          )}
          {request.kind === 'form' && (
            <fieldset disabled={locked} className="min-w-0 space-y-4">
              {request.kind === 'form' && request.url && (
                <div className="space-y-3 text-[12px]">
                  <p className="text-fg-muted">
                    Complete the request in your browser, then confirm here.
                  </p>
                  <button
                    type="button"
                    className={`${button} text-fg max-w-full text-left break-all`}
                    disabled={locked || !onOpenUrl}
                    onClick={() => {
                      setError(null);
                      void onOpenUrl?.(request.url!).catch((e) => setError(String(e)));
                    }}
                  >
                    {request.url}
                  </button>
                </div>
              )}
              {request.kind === 'form' &&
                !request.url &&
                (simpleForm ? (
                  Object.entries(properties).map(([key, schema]) => (
                    <label key={key} className="text-fg-muted block space-y-2 text-[12px]">
                      <span>
                        {schema.title ?? key}
                        {required.includes(key) ? ' *' : ''}
                      </span>
                      {schema.description && <span className="block">{schema.description}</span>}
                      {schema.enum ? (
                        <SearchableSelect
                          label={`${key}${required.includes(key) ? ' (required)' : ''}`}
                          className="mt-1"
                          searchable={schema.enum.length > 8}
                          placeholder="Choose…"
                          value={String(form[key] ?? schema.default ?? '')}
                          options={schema.enum.map((value) => ({
                            value: String(value),
                            label: String(value),
                          }))}
                          onChange={(value) => setForm((p) => ({ ...p, [key]: value }))}
                        />
                      ) : schema.type === 'boolean' ? (
                        <SearchableSelect
                          label={`${key}${required.includes(key) ? ' (required)' : ''}`}
                          className="mt-1"
                          searchable={false}
                          menuWidth={200}
                          placeholder="Choose…"
                          value={
                            form[key] === undefined
                              ? String(schema.default ?? '')
                              : String(form[key])
                          }
                          options={[
                            { value: 'true', label: 'Yes' },
                            { value: 'false', label: 'No' },
                          ]}
                          onChange={(value) =>
                            setForm((p) => ({
                              ...p,
                              [key]: value === '' ? undefined : value === 'true',
                            }))
                          }
                        />
                      ) : ['number', 'integer'].includes(schema.type ?? '') ? (
                        <input
                          required={required.includes(key)}
                          className={field}
                          type="number"
                          min={schema.minimum}
                          max={schema.maximum}
                          step={schema.type === 'integer' ? 1 : 'any'}
                          value={String(form[key] ?? schema.default ?? '')}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              [key]: e.target.value === '' ? undefined : Number(e.target.value),
                            }))
                          }
                        />
                      ) : (
                        <input
                          required={required.includes(key)}
                          className={field}
                          value={String(form[key] ?? schema.default ?? '')}
                          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                        />
                      )}
                    </label>
                  ))
                ) : (
                  <label className="text-fg-muted block space-y-2 text-[12px]">
                    Structured response (JSON)
                    <details>
                      <summary className="cursor-pointer">Requested schema</summary>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(request.schema, null, 2)}
                      </pre>
                    </details>
                    <textarea
                      className={`${field} min-h-36 font-mono`}
                      value={raw}
                      onChange={(e) => setRaw(e.target.value)}
                    />
                  </label>
                ))}
            </fieldset>
          )}
          {error && (
            <p role="alert" className="text-status-error text-[12px] leading-relaxed">
              {error}
            </p>
          )}
        </div>
        <footer className="border-border/60 bg-fg/2 flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          {request.kind === 'question' && (
            <>
              <div className="text-fg-dim flex items-center gap-2 text-[11px]">
                {currentIndex > 0 ? (
                  <button
                    type="button"
                    className={`${button} !border-transparent !px-2`}
                    disabled={locked}
                    onClick={() => goTo(currentIndex - 1)}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                ) : (
                  <span>⌘ / Ctrl + Enter</span>
                )}
              </div>
              <button
                type="submit"
                className={
                  currentIndex < questions.length - 1 ? `${button} bg-fg/5` : primaryButton
                }
                disabled={locked}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy
                  ? 'Sending…'
                  : currentIndex < questions.length - 1
                    ? 'Next question'
                    : questions.length > 1
                      ? 'Send answers'
                      : 'Send answer'}
                {!busy &&
                  (currentIndex < questions.length - 1 ? (
                    <ArrowRight className="h-3.5 w-3.5" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  ))}
              </button>
            </>
          )}
          {request.kind === 'approval' && (
            <div className="flex flex-wrap items-center gap-2">
              {(request.choices ?? []).map((choice, index) => (
                <button
                  key={index}
                  type="button"
                  disabled={locked}
                  className={button}
                  onClick={() => void send({ decision: choice.value })}
                >
                  {choice.label}
                </button>
              ))}
              {busy && (
                <Loader2
                  aria-label="Sending decision"
                  className="text-fg-dim h-4 w-4 animate-spin"
                />
              )}
            </div>
          )}
          {request.kind === 'form' && (
            <>
              <button
                type="button"
                disabled={locked}
                className={`${button} !border-transparent`}
                onClick={() => void send({ action: 'decline' })}
              >
                Decline
              </button>
              <button type="submit" disabled={locked} className={primaryButton}>
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" />
                )}
                {busy ? 'Sending…' : request.url ? 'I’ve completed this' : 'Submit response'}
              </button>
            </>
          )}
        </footer>
      </form>
    </section>
  );
}
