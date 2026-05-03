import type { ReactNode } from 'react';

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  separator?: boolean;
  /**
   * Nested items turn this row into a submenu parent. The row opens on
   * hover/focus and items inside close the whole menu on click — this is
   * the standard desktop affordance (Finder, VS Code, Linear) and keeps
   * the top-level list short while still exposing "Open in..." variants.
   */
  children?: MenuItem[];
}
