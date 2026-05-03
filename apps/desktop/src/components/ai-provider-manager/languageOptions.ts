export interface LanguageOption {
  value: string;
  label: string;
  flag: string | null;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'auto', label: 'Auto (match my message)', flag: null },
  { value: 'en', label: 'English', flag: '🇬🇧' },
  { value: 'tr', label: 'Turkish (Türkçe)', flag: '🇹🇷' },
  { value: 'de', label: 'German (Deutsch)', flag: '🇩🇪' },
  { value: 'fr', label: 'French (Français)', flag: '🇫🇷' },
  { value: 'es', label: 'Spanish (Español)', flag: '🇪🇸' },
  { value: 'it', label: 'Italian (Italiano)', flag: '🇮🇹' },
  { value: 'pt', label: 'Portuguese (Português)', flag: '🇵🇹' },
  { value: 'nl', label: 'Dutch (Nederlands)', flag: '🇳🇱' },
  { value: 'pl', label: 'Polish (Polski)', flag: '🇵🇱' },
  { value: 'ru', label: 'Russian (Русский)', flag: '🇷🇺' },
  { value: 'uk', label: 'Ukrainian (Українська)', flag: '🇺🇦' },
  { value: 'ja', label: 'Japanese (日本語)', flag: '🇯🇵' },
  { value: 'ko', label: 'Korean (한국어)', flag: '🇰🇷' },
  { value: 'zh', label: 'Chinese (中文)', flag: '🇨🇳' },
  { value: 'ar', label: 'Arabic (العربية)', flag: '🇸🇦' },
  { value: 'he', label: 'Hebrew (עברית)', flag: '🇮🇱' },
  { value: 'hi', label: 'Hindi (हिन्दी)', flag: '🇮🇳' },
];

export const COMMIT_LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'inherit', label: 'Inherit (use response language)', flag: null },
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
  if (option && option.value === 'inherit') return `Inherit · ${languageLabel(fallback)}`;
  if (!option) return (value ?? 'inherit').trim().toLowerCase() || 'inherit';
  return option.flag ? `${option.flag} ${option.label}` : option.label;
}
