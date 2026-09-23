'use client';

import { Fragment, createElement, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { getLocale, message, subscribe, type MessageKey } from './core';
// This entry deliberately exposes hooks and pure translation helpers together.
// eslint-disable-next-line react-refresh/only-export-components
export * from './core';

/** Subscribe without remounting the screen, losing drafts, or restarting running agents. */
export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, () => 'en' as const);
}

/** A complete translated sentence can reorder styled links, keyboard hints, and live values. */
export function rich(key: MessageKey, values: Readonly<Record<string, ReactNode>>): ReactNode {
  const occurrences = new Map<string, number>();
  return message(key)
    .split(/(\{\w+\})/g)
    .map((part, index) => {
      const name = part.startsWith('{') ? part.slice(1, -1) : null;
      const value = name !== null && Object.hasOwn(values, name) ? values[name] : part;
      const occurrence = name ? (occurrences.get(name) ?? 0) : 0;
      if (name) occurrences.set(name, occurrence + 1);
      const fragmentKey = name ? `value:${name}:${occurrence}` : `text:${index}`;
      return createElement(Fragment, { key: fragmentKey }, value);
    });
}

/** Invalidate derived labels when the language changes, while keeping normal memo dependencies. */
export function useLocaleMemo<T>(
  factory: () => T,
  dependencies: import('react').DependencyList,
): T {
  const locale = useLocale();
  // The caller owns the dependency list, like React.useMemo. Locale is an additional dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, [locale, ...dependencies]);
}

export { enumLabel } from './labels';
