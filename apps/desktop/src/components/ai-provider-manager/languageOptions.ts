import * as i18n from '@runhq/cockpit-ui/i18n/core';
export interface LanguageOption {
  value: string;
  label: string;
  flag: string | null;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    value: 'auto',
    get label() {
      return i18n.t('Auto (match my message)');
    },
    flag: null,
  },
  {
    value: 'en',
    get label() {
      return i18n.t('English');
    },
    flag: '🇬🇧',
  },
  {
    value: 'tr',
    get label() {
      return i18n.t('Turkish (Türkçe)');
    },
    flag: '🇹🇷',
  },
  {
    value: 'de',
    get label() {
      return i18n.t('German (Deutsch)');
    },
    flag: '🇩🇪',
  },
  {
    value: 'fr',
    get label() {
      return i18n.t('French (Français)');
    },
    flag: '🇫🇷',
  },
  {
    value: 'es',
    get label() {
      return i18n.t('Spanish (Español)');
    },
    flag: '🇪🇸',
  },
  {
    value: 'it',
    get label() {
      return i18n.t('Italian (Italiano)');
    },
    flag: '🇮🇹',
  },
  {
    value: 'pt',
    get label() {
      return i18n.t('Portuguese (Português)');
    },
    flag: '🇵🇹',
  },
  {
    value: 'nl',
    get label() {
      return i18n.t('Dutch (Nederlands)');
    },
    flag: '🇳🇱',
  },
  {
    value: 'pl',
    get label() {
      return i18n.t('Polish (Polski)');
    },
    flag: '🇵🇱',
  },
  {
    value: 'ru',
    get label() {
      return i18n.t('Russian (Русский)');
    },
    flag: '🇷🇺',
  },
  {
    value: 'uk',
    get label() {
      return i18n.t('Ukrainian (Українська)');
    },
    flag: '🇺🇦',
  },
  {
    value: 'ja',
    get label() {
      return i18n.t('Japanese (日本語)');
    },
    flag: '🇯🇵',
  },
  {
    value: 'ko',
    get label() {
      return i18n.t('Korean (한국어)');
    },
    flag: '🇰🇷',
  },
  {
    value: 'zh',
    get label() {
      return i18n.t('Chinese (中文)');
    },
    flag: '🇨🇳',
  },
  {
    value: 'ar',
    get label() {
      return i18n.t('Arabic (العربية)');
    },
    flag: '🇸🇦',
  },
  {
    value: 'he',
    get label() {
      return i18n.t('Hebrew (עברית)');
    },
    flag: '🇮🇱',
  },
  {
    value: 'hi',
    get label() {
      return i18n.t('Hindi (हिन्दी)');
    },
    flag: '🇮🇳',
  },
];

export const COMMIT_LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    value: 'inherit',
    get label() {
      return i18n.t('Inherit (use response language)');
    },
    flag: null,
  },
  ...LANGUAGE_OPTIONS,
];

export function languageOption(value: string | null | undefined) {
  const normalized = (value ?? 'auto').trim().toLowerCase() || 'auto';
  return LANGUAGE_OPTIONS.find((option) => option.value === normalized);
}

export function languageLabel(value: string | null | undefined): string {
  const option = languageOption(value);
  if (!option) return (value ?? 'auto').trim().toLowerCase() || 'auto';
  return option.flag ? `${option.flag} ${option.label}` : option.label;
}

export function commitLanguageOption(value: string | null | undefined) {
  const normalized = (value ?? 'inherit').trim().toLowerCase() || 'inherit';
  return COMMIT_LANGUAGE_OPTIONS.find((option) => option.value === normalized);
}

export function commitLanguageLabel(
  value: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const option = commitLanguageOption(value);
  if (option && option.value === 'inherit')
    return i18n.t('Inherit · {value1}', { value1: languageLabel(fallback) });
  if (!option) return (value ?? 'inherit').trim().toLowerCase() || 'inherit';
  return option.flag ? `${option.flag} ${option.label}` : option.label;
}
