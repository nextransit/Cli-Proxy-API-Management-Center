import { useCallback, useState } from 'react';

export type Granularity = 'hour' | 'day';

export interface UseGranularityResult {
  granularity: Granularity;
  setGranularity: (next: Granularity) => void;
  reset: () => void;
}

const STORAGE_PREFIX = 'usage.granularity.';
const isGranularity = (value: unknown): value is Granularity =>
  value === 'hour' || value === 'day';

const readStored = (cardId: string): Granularity | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${cardId}`);
    return isGranularity(raw) ? raw : null;
  } catch {
    return null;
  }
};

const writeStored = (cardId: string, value: Granularity): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`${STORAGE_PREFIX}${cardId}`, value);
  } catch {
    // Ignore storage errors (e.g. private mode, quota exceeded).
  }
};

const clearStored = (cardId: string): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(`${STORAGE_PREFIX}${cardId}`);
  } catch {
    // Ignore storage errors.
  }
};

export function useGranularity(
  cardId: string,
  defaultValue: Granularity = 'hour',
): UseGranularityResult {
  const [granularity, setGranularityState] = useState<Granularity>(
    () => readStored(cardId) ?? defaultValue,
  );

  const setGranularity = useCallback(
    (next: Granularity) => {
      writeStored(cardId, next);
      setGranularityState(next);
    },
    [cardId],
  );

  const reset = useCallback(() => {
    clearStored(cardId);
    setGranularityState(defaultValue);
  }, [cardId, defaultValue]);

  return { granularity, setGranularity, reset };
}
