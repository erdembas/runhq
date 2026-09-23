import en from './en.json';
import tr from './tr.json';

export type Locale = 'en' | 'tr';
export type MessageKey = keyof typeof en;
export type Values = Readonly<Record<string, string | number | null | undefined>>;
export const LOCALE_STORAGE_KEY = 'rhq-locale';
export const LOCALES: readonly Locale[] = ['en', 'tr'];
const listeners = new Set<() => void>();
let locale: Locale = 'en';

export function resolveLocale(value: unknown): Locale {
  return typeof value === 'string' && /^tr(?:[-_]|$)/i.test(value) ? 'tr' : 'en';
}
export function getLocale(): Locale {
  return locale;
}
export function getFormatLocale(): string {
  return locale === 'tr' ? 'tr-TR' : 'en-US';
}
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** Change display language only. Never translate user/agent content or persisted identifiers. */
export function setLocale(next: Locale, persist = true): void {
  if (!LOCALES.includes(next)) return;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* Private/blocked storage. */
    }
  }
  if (next === locale) return;
  locale = next;
  listeners.forEach((listener) => listener());
}
/** Desktop opts in at boot; shared components and the marketing site default to English. */
export function initializeLocale(): () => void {
  if (typeof window === 'undefined') return () => {};
  const preferred = () => {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === 'tr' || saved === 'en') return saved;
    } catch {
      /* Fall back to system language. */
    }
    return resolveLocale(window.navigator.language);
  };
  setLocale(preferred(), false);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY || event.key === null) setLocale(preferred(), false);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
export function message(key: MessageKey, language: Locale = locale): string {
  const translated = (tr as Partial<Record<MessageKey, string>>)[key];
  return language === 'tr' && translated !== undefined ? translated : (en[key] ?? key);
}
/** Placeholder substitution is deliberately non-recursive; supplied content stays verbatim. */
export function t(key: MessageKey, values: Values = {}): string {
  return message(key).replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}
export function number(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getFormatLocale(), options).format(value);
}
export function date(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(getFormatLocale(), options).format(value);
}
export function relative(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(getFormatLocale(), { numeric: 'auto' }).format(value, unit);
}

/** Translate a complete count-dependent message. Both keys must exist in both catalogs. */
export function plural(
  one: MessageKey,
  other: MessageKey,
  count: number,
  values: Values = {},
): string {
  const key = new Intl.PluralRules(getFormatLocale()).select(count) === 'one' ? one : other;
  return t(key, { ...values, count: number(count) });
}
