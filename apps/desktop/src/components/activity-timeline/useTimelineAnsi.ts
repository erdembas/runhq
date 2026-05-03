import { useEffect, useMemo, useState } from 'react';
import { makeAnsiConverter } from '@/lib/ansi';

export function useTimelineAnsi() {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark')),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const ansi = useMemo(() => makeAnsiConverter(isDark), [isDark]);

  return { ansi, isDark };
}
