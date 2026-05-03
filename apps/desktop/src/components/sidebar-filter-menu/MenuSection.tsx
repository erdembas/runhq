interface MenuSectionProps {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function MenuSection({ label, action, children }: MenuSectionProps) {
  return (
    <div className="px-3 pt-2.5 pb-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-fg-dim text-[9.5px] font-semibold tracking-[0.14em] uppercase">
          {label}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}
