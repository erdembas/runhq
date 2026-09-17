export interface SearchableOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  group?: string;
  groupId?: string;
  color?: string;
  keywords?: string;
  disabled?: boolean;
}

export function filterSelectOptions<T extends SearchableOption>(options: T[], query: string): T[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    const text =
      `${option.label} ${option.description ?? ''} ${option.group ?? ''} ${option.keywords ?? ''}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}
