import { forwardRef, type InputHTMLAttributes } from 'react';
import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/cn';

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

// Keep native keyboard/form semantics while drawing every state with our theme.
function choice(type: 'checkbox' | 'radio') {
  const Component = forwardRef<HTMLInputElement, ChoiceProps>(({ className, ...props }, ref) => (
    <span
      className={cn(
        'relative mt-0.5 inline-flex size-4 shrink-0 has-[:disabled]:opacity-40',
        className,
      )}
    >
      <input
        {...props}
        ref={ref}
        type={type}
        className={cn(
          'peer border-border-strong bg-surface checked:border-accent checked:bg-accent focus-visible:ring-accent/30 size-4 cursor-pointer appearance-none border shadow-xs transition outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed',
          type === 'checkbox' ? 'rounded-[4px]' : 'rounded-full',
        )}
      />
      {type === 'checkbox' ? (
        <Check
          aria-hidden="true"
          className="text-accent-fg pointer-events-none absolute inset-0 size-4 p-0.5 opacity-0 peer-checked:opacity-100"
          strokeWidth={3}
        />
      ) : (
        <Circle
          aria-hidden="true"
          className="text-accent-fg pointer-events-none absolute inset-0 size-4 fill-current p-1 opacity-0 peer-checked:opacity-100"
        />
      )}
    </span>
  ));
  Component.displayName = type === 'checkbox' ? 'Checkbox' : 'Radio';
  return Component;
}

export const Checkbox = choice('checkbox');
export const Radio = choice('radio');
