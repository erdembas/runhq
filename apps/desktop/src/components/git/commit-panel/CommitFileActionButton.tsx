import * as i18n from '@runhq/cockpit-ui/i18n';
import type { ReactNode } from 'react';

interface CommitFileActionButtonProps {
  path: string;
  className: string;
  title: string;
  icon: ReactNode;
  onClick: (path: string) => void;
}

export function CommitFileActionButton({
  path,
  className,
  title,
  icon,
  onClick,
}: CommitFileActionButtonProps) {
  i18n.useLocale();
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        void onClick(path);
      }}
      className={`flex h-5 w-5 items-center justify-center rounded transition ${className}`}
      title={title}
      aria-label={`${title.replace(i18n.t('this file'), '')} ${path}`}
    >
      {icon}
    </button>
  );
}
