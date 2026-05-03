import type { ReactNode } from 'react';

interface FormatButtonProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

export function FormatButton({ icon, label, onClick }: FormatButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="text-fg-dim hover:text-fg hover:bg-fg/5 inline-flex h-7 w-7 items-center justify-center rounded transition"
    >
      {icon}
    </button>
  );
}
