import { useCallback, useState } from 'react';

const WIDE_LAYOUT_STORAGE_KEY = 'runhq.docs.wideLayout';

export function useWideLayoutPref(): [boolean, () => void] {
  const [wide, setWide] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(WIDE_LAYOUT_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setWide((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(WIDE_LAYOUT_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  return [wide, toggle];
}
