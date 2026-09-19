/** Versioned local recovery data. A failed write must never be reported as durable. */
export interface RecoveryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function createAgentRecoveryPersistence<T>(
  key: string,
  validate: (value: unknown) => value is T,
  getStorage: () => RecoveryStorage = () => window.localStorage,
) {
  let unreadable: string | null = null;
  return {
    load(fallback: T): { data: T; error: string | null } {
      try {
        const raw = getStorage().getItem(key);
        if (!raw) return { data: fallback, error: null };
        unreadable = raw;
        const record: unknown = JSON.parse(raw);
        if (
          !record ||
          typeof record !== 'object' ||
          !('version' in record) ||
          record.version !== 1 ||
          !('data' in record) ||
          !validate(record.data)
        )
          throw new Error('unsupported or damaged recovery data');
        unreadable = null;
        return { data: record.data, error: null };
      } catch {
        return {
          data: fallback,
          error:
            'Saved recovery data could not be loaded. Your previous data is kept; new changes need a successful local save.',
        };
      }
    },
    save(data: T): string | null {
      try {
        const storage = getStorage();
        // Preserve an unreadable payload before replacing it. A failed backup also blocks save.
        if (unreadable !== null) {
          storage.setItem(`${key}:unreadable-backup`, unreadable);
          unreadable = null;
        }
        storage.setItem(key, JSON.stringify({ version: 1, data }));
        return null;
      } catch {
        return 'Local recovery could not be saved. Keep RunHQ open and retry; your latest changes are only in memory.';
      }
    },
  };
}

export const isStringRecord = (value: unknown): value is Record<string, string> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === 'string');

export const isNumberRecord = (value: unknown): value is Record<string, number> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry));
