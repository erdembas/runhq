import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ mono, className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(
        'border-border bg-surface-raised text-fg rounded-app-sm w-full border px-2.5 py-1.5 text-[12px]',
        'placeholder:text-fg-dim',
        'focus:border-accent transition focus:outline-none',
        mono && 'font-mono',
        className,
      )}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ mono, className, rows = 4, ...rest }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'border-border bg-surface-raised text-fg rounded-app-sm w-full border px-2.5 py-1.5 text-[12px]',
        'placeholder:text-fg-dim',
        'focus:border-accent transition focus:outline-none',
        'resize-y leading-snug',
        mono && 'font-mono',
        className,
      )}
      {...rest}
    />
  ),
);
Textarea.displayName = 'Textarea';

interface FieldProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="text-fg-dim block text-[11px] font-semibold tracking-[0.14em] uppercase">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-status-error text-[11px]">{error}</p>
      ) : hint ? (
        <p className="text-fg-dim text-[11px]">{hint}</p>
      ) : null}
    </div>
  );
}
