'use client';
import { useId, useState } from 'react';
import { CircleHelp, Loader2, ShieldQuestion } from 'lucide-react';
import type { AgentRequest } from '@runhq/cockpit-types';

const field =
  'bg-surface border-border text-fg focus:border-accent w-full rounded-md border px-3 py-2 text-[13px] outline-none';
const button =
  'border-border hover:bg-fg/5 disabled:opacity-40 rounded-md border px-3 py-2 text-[12px] transition-colors';

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
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [raw, setRaw] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const questions = request.questions ?? [];
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
  const send = async (value: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await onAnswer(value);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const questionSubmit = () => {
    const combined = Object.fromEntries(
      questions.map((q) => [
        q.id,
        q.allow_custom !== false && custom[q.id]?.trim()
          ? [...(q.multiple ? (answers[q.id] ?? []) : []), custom[q.id]!.trim()]
          : (answers[q.id] ?? []),
      ]),
    );
    if (questions.some((q) => !combined[q.id]?.length)) {
      setError('Please answer every question.');
      return;
    }
    void send({ answers: combined });
  };
  const formSubmit = () => {
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
      void send({ action: 'accept', content });
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section
      className="border-accent/35 bg-accent/5 space-y-4 rounded-lg border p-4"
      aria-label={request.title}
    >
      <div className="text-fg flex items-center gap-2 text-[13px] font-medium">
        {request.kind === 'approval' ? (
          <ShieldQuestion className="text-accent h-4 w-4" />
        ) : (
          <CircleHelp className="text-accent h-4 w-4" />
        )}
        {request.title}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
      {request.details && (
        <details className="text-fg-muted text-[12px]" open={request.kind === 'approval'}>
          <summary className="cursor-pointer">Request details</summary>
          <pre className="bg-surface mt-2 max-h-56 overflow-auto rounded-md p-3 break-words whitespace-pre-wrap">
            {request.details}
          </pre>
        </details>
      )}
      {questions.map((q) => (
        <fieldset key={q.id} disabled={disabled || busy} className="space-y-2">
          <legend className="text-fg mb-2 text-[13px]">{q.question}</legend>
          {q.options.map((option) => (
            <label
              key={option.value ?? option.label}
              className="border-border hover:bg-fg/5 flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-[12px]"
            >
              <input
                type={q.multiple ? 'checkbox' : 'radio'}
                name={`${cardId}-${q.id}`}
                checked={(answers[q.id] ?? []).includes(option.value ?? option.label)}
                onChange={(event) =>
                  setAnswers((previous) => ({
                    ...previous,
                    [q.id]: q.multiple
                      ? event.target.checked
                        ? [...(previous[q.id] ?? []), option.value ?? option.label]
                        : (previous[q.id] ?? []).filter((v) => v !== (option.value ?? option.label))
                      : [option.value ?? option.label],
                  }))
                }
                className="accent-accent mt-0.5"
              />
              <span>
                <span className="text-fg">{option.label}</span>
                {option.description && (
                  <span className="text-fg-muted mt-1 block">{option.description}</span>
                )}
              </span>
            </label>
          ))}
          {q.allow_custom !== false && (
            <label className="text-fg-muted block space-y-1 text-[12px]">
              <span>{q.options.length ? 'Additional or alternative answer' : 'Your answer'}</span>
              <input
                type={q.secret ? 'password' : 'text'}
                autoComplete="off"
                className={field}
                value={custom[q.id] ?? ''}
                onChange={(e) => setCustom((previous) => ({ ...previous, [q.id]: e.target.value }))}
              />
            </label>
          )}
        </fieldset>
      ))}
      {request.kind === 'form' && request.url && (
        <div className="space-y-2 text-[12px]">
          <p className="text-fg-muted">Complete the request in your browser, then confirm here.</p>
          <button
            type="button"
            className={`${button} text-accent max-w-full text-left break-all`}
            disabled={busy || disabled || !onOpenUrl}
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
            <label key={key} className="text-fg-muted block space-y-1 text-[12px]">
              <span>
                {schema.title ?? key}
                {required.includes(key) ? ' *' : ''}
              </span>
              {schema.description && <span className="block">{schema.description}</span>}
              {schema.enum ? (
                <select
                  className={field}
                  value={String(form[key] ?? schema.default ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                >
                  <option value="">Choose…</option>
                  {schema.enum.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              ) : schema.type === 'boolean' ? (
                <select
                  className={field}
                  value={form[key] === undefined ? String(schema.default ?? '') : String(form[key])}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      [key]: e.target.value === '' ? undefined : e.target.value === 'true',
                    }))
                  }
                >
                  <option value="">Choose…</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : ['number', 'integer'].includes(schema.type ?? '') ? (
                <input
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
                  className={field}
                  value={String(form[key] ?? schema.default ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                />
              )}
            </label>
          ))
        ) : (
          <label className="text-fg-muted block space-y-1 text-[12px]">
            Structured response (JSON)
            <details>
              <summary className="cursor-pointer">Requested schema</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(request.schema, null, 2)}
              </pre>
            </details>
            <textarea
              className={`${field} min-h-28 font-mono`}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </label>
        ))}
      {error && (
        <p role="alert" className="text-status-error text-[12px]">
          {error}
        </p>
      )}
      <fieldset disabled={busy || disabled} className="flex flex-wrap gap-2">
        {request.kind === 'question' && (
          <button
            className={`${button} bg-accent text-surface border-accent font-medium`}
            disabled={busy || disabled}
            onClick={questionSubmit}
          >
            Send answers
          </button>
        )}
        {request.kind === 'approval' &&
          (request.choices ?? []).map((choice, index) => (
            <button
              key={index}
              disabled={busy || disabled}
              className={button}
              onClick={() => void send({ decision: choice.value })}
            >
              {choice.label}
            </button>
          ))}
        {request.kind === 'form' && (
          <>
            <button disabled={busy || disabled} className={button} onClick={formSubmit}>
              {request.url ? 'I have completed the request' : 'Submit response'}
            </button>
            <button
              disabled={busy || disabled}
              className={button}
              onClick={() => void send({ action: 'decline' })}
            >
              Decline
            </button>
          </>
        )}
      </fieldset>
    </section>
  );
}
